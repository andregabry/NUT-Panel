import time
import json
import logging
import threading
import urllib.request
import urllib.error
from functools import wraps
from collections import deque
from flask import Flask, render_template, jsonify, request, Response, session, redirect, url_for
from config import Config
from nut_client import NutClient
from shutdown_manager import ShutdownManager
from auth_manager import AuthManager
from alert_manager import AlertManager
from connections_manager import ConnectionsManager

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger(__name__)

app = Flask(__name__)
app.config.from_object(Config)
app.secret_key = Config.SECRET_KEY

# Gestores de recursos
nut_client = NutClient(
    host=Config.NUT_HOST,
    port=Config.NUT_PORT,
    ups_name=Config.NUT_UPS_NAME,
    username=Config.NUT_USERNAME,
    password=Config.NUT_PASSWORD
)

shutdown_manager = ShutdownManager()
auth_manager = AuthManager()
alert_manager = AlertManager()
connections_manager = ConnectionsManager()

latest_data = {
    "connected": False,
    "error": "A inicializar conexão...",
    "timestamp": time.time()
}

# Histórico para gráficos
history_buffer = deque(maxlen=Config.MAX_HISTORY_POINTS)
subscribers = []
state_lock = threading.Lock()

# Decorador de controle de acesso
def login_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if "user" not in session:
            if request.path.startswith("/api/"):
                return jsonify({"error": "Unauthorized", "message": "Autenticação necessária"}), 401
            return redirect(url_for("login"))
        return f(*args, **kwargs)
    return decorated_function

def nut_polling_worker():
    global latest_data
    logger.info(f"Iniciando thread de polling da UPS em {Config.NUT_HOST}:{Config.NUT_PORT}...")
    
    consecutive_errors = 0
    while True:
        try:
            data = nut_client.get_all_vars()
            with state_lock:
                latest_data = data
                consecutive_errors = 0
                
                # Adicionar ponto ao histórico
                history_buffer.append({
                    "timestamp": data["timestamp"],
                    "time": data["formatted_time"],
                    "load_pct": data["output"]["load_pct"],
                    "real_power_w": data["output"]["real_power_w"],
                    "input_voltage": data["input"]["voltage"],
                    "output_voltage": data["output"]["voltage"],
                    "battery_charge": data["battery"]["charge_pct"],
                    "battery_voltage": data["battery"]["voltage"]
                })

            # Verificar gatilhos de múltiplos planos de desligamento
            shutdown_manager.check_nut_triggers(data)

            # Verificar regras de alertas e notificações
            alert_manager.check_nut_alerts(data)
            
            # Anexar planos ao payload transmitido
            stream_data = {
                **data,
                "plans_data": shutdown_manager.get_all_plans()
            }

            # Notificar clientes SSE
            payload = f"data: {json.dumps(stream_data)}\n\n"
            dead_subs = []
            for q in subscribers:
                try:
                    q.put_nowait(payload)
                except Exception:
                    dead_subs.append(q)
            for q in dead_subs:
                if q in subscribers:
                    subscribers.remove(q)
                    
        except Exception as e:
            consecutive_errors += 1
            if consecutive_errors == 1 or consecutive_errors % 10 == 0:
                logger.error(f"Falha na leitura do NUT: {e}")
            with state_lock:
                latest_data = {
                    "connected": False,
                    "error": str(e),
                    "timestamp": time.time()
                }
        
        time.sleep(Config.POLL_INTERVAL)

# Inicia thread de background
poll_thread = threading.Thread(target=nut_polling_worker, daemon=True)
poll_thread.start()

# ----------------- ROTAS DE AUTENTICAÇÃO ----------------- #

@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "GET":
        if "user" in session:
            return redirect(url_for("index"))
        return render_template("login.html")
    
    data = request.get_json(force=True) if request.is_json else request.form
    username = data.get("username", "")
    password = data.get("password", "")

    user_info = auth_manager.authenticate(username, password)
    if user_info:
        session["user"] = user_info["username"]
        session["role"] = user_info["role"]
        return jsonify({"success": True, "message": "Autenticado com sucesso"})
    
    return jsonify({"success": False, "message": "Utilizador ou senha incorretos."}), 401

@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))

@app.route("/api/auth/change-password", methods=["POST"])
@login_required
def change_password():
    data = request.get_json(force=True)
    old_pass = data.get("old_password", "")
    new_pass = data.get("new_password", "")
    username = session.get("user")
    
    res = auth_manager.change_password(username, old_pass, new_pass)
    return jsonify(res)

# ----------------- ROTAS DO PAINEL PROTEGIDAS ----------------- #

@app.route("/")
@login_required
def index():
    return render_template("index.html", current_user=session.get("user", "admin"))

@app.route("/api/status")
@login_required
def api_status():
    with state_lock:
        data = {
            **latest_data,
            "plans_data": shutdown_manager.get_all_plans(),
            "current_user": session.get("user", "admin")
        }
        res = jsonify(data)
        res.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return res

@app.route("/api/history")
@login_required
def api_history():
    with state_lock:
        return jsonify(list(history_buffer))

@app.route("/api/stream")
@login_required
def api_stream():
    import queue
    current_username = session.get("user", "admin")
    q = queue.Queue(maxsize=10)
    subscribers.append(q)
    
    def event_stream():
        with state_lock:
            initial = {
                **latest_data,
                "plans_data": shutdown_manager.get_all_plans(),
                "current_user": current_username
            }
            yield f"data: {json.dumps(initial)}\n\n"
            
        try:
            while True:
                try:
                    msg = q.get(timeout=15)
                    yield msg
                except queue.Empty:
                    yield ": keep-alive\n\n"
        except GeneratorExit:
            if q in subscribers:
                subscribers.remove(q)

    res = Response(event_stream(), mimetype="text/event-stream")
    res.headers["Cache-Control"] = "no-cache, no-transform"
    res.headers["X-Accel-Buffering"] = "no"
    return res

# ----------------- APIS DE MÚLTIPLOS PLANOS DE DESLIGAMENTO ----------------- #

@app.route("/api/plans", methods=["GET"])
@login_required
def get_plans():
    return jsonify(shutdown_manager.get_all_plans())

@app.route("/api/plans", methods=["POST"])
@login_required
def save_plan():
    body = request.get_json(force=True)
    plan = shutdown_manager.create_or_update_plan(body)
    return jsonify({"success": True, "plan": plan})

@app.route("/api/plans/<plan_id>", methods=["DELETE"])
@login_required
def delete_plan(plan_id):
    success = shutdown_manager.delete_plan(plan_id)
    return jsonify({"success": success})

@app.route("/api/plans/<plan_id>/server", methods=["POST"])
@login_required
def save_plan_server(plan_id):
    body = request.get_json(force=True)
    try:
        server = shutdown_manager.add_or_update_server(plan_id, body)
        return jsonify({"success": True, "server": server})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 400

@app.route("/api/plans/<plan_id>/server/<server_id>", methods=["DELETE"])
@login_required
def delete_plan_server(plan_id, server_id):
    success = shutdown_manager.delete_server(plan_id, server_id)
    return jsonify({"success": success})

@app.route("/api/plans/<plan_id>/server/<server_id>/test", methods=["POST"])
@login_required
def test_plan_server(plan_id, server_id):
    plan = shutdown_manager.get_plan_by_id(plan_id)
    if not plan:
        return jsonify({"success": False, "message": "Plano não encontrado"}), 404
    server = next((s for s in plan.get("servers", []) if s.get("id") == server_id), None)
    if not server:
        return jsonify({"success": False, "message": "Servidor não encontrado"}), 404
    
    res = shutdown_manager.test_connection(server)
    return jsonify(res)

@app.route("/api/plans/<plan_id>/server/<server_id>/execute", methods=["POST"])
@login_required
def execute_plan_server_manual(plan_id, server_id):
    body = request.get_json(silent=True) or {}
    dry_run = body.get("dry_run", False)
    
    plan = shutdown_manager.get_plan_by_id(plan_id)
    if not plan:
        return jsonify({"success": False, "message": "Plano não encontrado"}), 404
    server = next((s for s in plan.get("servers", []) if s.get("id") == server_id), None)
    if not server:
        return jsonify({"success": False, "message": "Servidor não encontrado"}), 404
    
    res = shutdown_manager.execute_shutdown_server(server, plan_name=plan.get("name", ""), dry_run=dry_run)
    return jsonify(res)

@app.route("/api/plans/<plan_id>/trigger", methods=["POST"])
@login_required
def trigger_single_plan(plan_id):
    body = request.get_json(silent=True) or {}
    dry_run = body.get("dry_run", False)
    shutdown_manager.run_plan_async(plan_id, dry_run=dry_run)
    return jsonify({"success": True, "message": "Execução iniciada"})

@app.route("/api/plans/<plan_id>/cancel", methods=["POST"])
@login_required
def cancel_single_plan(plan_id):
    shutdown_manager.cancel_plan(plan_id)
    return jsonify({"success": True, "message": "Cancelamento solicitado"})

@app.route("/api/plans/logs", methods=["GET"])
@login_required
def get_all_logs():
    data = shutdown_manager.get_all_plans()
    return jsonify(data.get("logs", []))

# ----------------- APIS DE ALERTAS & NOTIFICAÇÕES ----------------- #

@app.route("/api/alerts", methods=["GET"])
@login_required
def get_alerts_data():
    return jsonify(alert_manager.get_all_data())

@app.route("/api/alerts/recipient", methods=["POST"])
@login_required
def save_alert_recipient():
    body = request.get_json(force=True)
    rec = alert_manager.save_recipient(body)
    return jsonify({"success": True, "recipient": rec})

@app.route("/api/alerts/recipient/<rec_id>", methods=["DELETE"])
@login_required
def delete_alert_recipient(rec_id):
    success = alert_manager.delete_recipient(rec_id)
    return jsonify({"success": success})

@app.route("/api/alerts/rule", methods=["POST"])
@login_required
def save_alert_rule():
    body = request.get_json(force=True)
    rule = alert_manager.save_rule(body)
    return jsonify({"success": True, "rule": rule})

@app.route("/api/alerts/rule/<rule_id>", methods=["DELETE"])
@login_required
def delete_alert_rule(rule_id):
    success = alert_manager.delete_rule(rule_id)
    return jsonify({"success": success})

@app.route("/api/alerts/channels", methods=["POST"])
@login_required
def save_alert_channels():
    body = request.get_json(force=True)
    success = alert_manager.save_channel_settings(body)
    return jsonify({"success": success})

@app.route("/api/alerts/test", methods=["POST"])
@login_required
def test_alert_channel():
    body = request.get_json(force=True)
    channel = body.get("channel", "email")
    rec_id = body.get("recipient_id", "")
    target = body.get("target", "")
    res = alert_manager.test_notification_channel(channel, rec_id, target)
    return jsonify(res)

@app.route("/api/alerts/logs", methods=["GET"])
@login_required
def get_alert_logs():
    data = alert_manager.get_all_data()
    return jsonify(data.get("logs", []))

# ----------------- APIS DE CONEXÕES & INTEGRAÇÕES ----------------- #

@app.route("/api/connections", methods=["GET"])
@login_required
def get_connections_data():
    return jsonify(connections_manager.get_all())

@app.route("/api/connections/nut", methods=["POST"])
@login_required
def update_nut_connection():
    body = request.get_json(force=True)
    res = connections_manager.update_nut_server(body)
    return jsonify({"success": True, "nut_server": res})

@app.route("/api/connections/nut/test", methods=["POST"])
@login_required
def test_nut_connection():
    body = request.get_json(force=True)
    host = body.get("host", Config.NUT_HOST)
    port = int(body.get("port", Config.NUT_PORT))
    ups_name = body.get("ups_name", Config.NUT_UPS_NAME)
    username = body.get("username", "")
    password = body.get("password", "")
    res = connections_manager.test_nut_connection(host, port, ups_name, username, password)
    return jsonify(res)

@app.route("/api/connections/proxmox", methods=["POST"])
@login_required
def save_proxmox_connection():
    body = request.get_json(force=True)
    server = connections_manager.save_proxmox_server(body)
    return jsonify({"success": True, "server": server})

@app.route("/api/connections/proxmox/<server_id>", methods=["DELETE"])
@login_required
def delete_proxmox_connection(server_id):
    success = connections_manager.delete_proxmox_server(server_id)
    return jsonify({"success": success})

@app.route("/api/connections/proxmox/test/<server_id>", methods=["POST"])
@login_required
def test_proxmox_connection(server_id):
    res = connections_manager.test_proxmox_server(server_id)
    return jsonify(res)

@app.route("/api/connections/vmware", methods=["POST"])
@login_required
def save_vmware_connection():
    body = request.get_json(force=True)
    server = connections_manager.save_vmware_server(body)
    return jsonify({"success": True, "server": server})

@app.route("/api/connections/vmware/<server_id>", methods=["DELETE"])
@login_required
def delete_vmware_connection(server_id):
    success = connections_manager.delete_vmware_server(server_id)
    return jsonify({"success": success})

@app.route("/api/connections/vmware/test/<server_id>", methods=["POST"])
@login_required
def test_vmware_connection(server_id):
    res = connections_manager.test_vmware_server(server_id)
    return jsonify(res)

@app.route("/api/connections/tokens/generate", methods=["POST"])
@login_required
def generate_api_token():
    body = request.get_json(force=True)
    name = body.get("name", "Nova Chave")
    perms = body.get("permissions", "read_only")
    token = connections_manager.generate_api_token(name, perms)
    return jsonify({"success": True, "token": token})

@app.route("/api/connections/tokens/<token_id>", methods=["DELETE"])
@login_required
def delete_api_token(token_id):
    success = connections_manager.delete_api_token(token_id)
    return jsonify({"success": success})

# Endpoint de API REST Externa v1 com suporte a Token Bearer
@app.route("/api/v1/status", methods=["GET"])
def external_api_status():
    auth_header = request.headers.get("Authorization", "")
    token_valid = False
    if auth_header.startswith("Bearer "):
        raw_token = auth_header[7:].strip()
        token_info = connections_manager.validate_api_token(raw_token)
        if token_info:
            token_valid = True
    elif "user" in session:
        token_valid = True

    if not token_valid:
        return jsonify({"error": "Unauthorized", "message": "Chave de API inválida ou ausente (Use Header 'Authorization: Bearer <chave>')"}), 401
    
    with state_lock:
        return jsonify({
            "status": "success",
            "device": "INVT HT1106XS 6kVA/6kW",
            "timestamp": latest_data.get("timestamp"),
            "data": latest_data
        })

# ----------------- WHATSAPP WEB MICROSERVICE PROXY ----------------- #

@app.route("/api/whatsapp/status", methods=["GET"])
@login_required
def get_whatsapp_web_status():
    try:
        req = urllib.request.Request(f"http://127.0.0.1:3001/status?t={int(time.time()*1000)}", headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            response = jsonify(data)
            response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
            return response
    except Exception as e:
        response = jsonify({
            "success": False,
            "connected": False,
            "state": "offline",
            "message": f"Microserviço WhatsApp Web indisponível ({str(e)})"
        })
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, max-age=0"
        return response

@app.route("/api/whatsapp/qr.png", methods=["GET"])
@login_required
def get_whatsapp_qr_png():
    try:
        req = urllib.request.Request(f"http://127.0.0.1:3001/qr.png?t={int(time.time()*1000)}")
        with urllib.request.urlopen(req, timeout=3) as resp:
            data = resp.read()
            return Response(data, mimetype="image/png", headers={"Cache-Control": "no-store, no-cache, must-revalidate, max-age=0"})
    except Exception as e:
        return jsonify({"error": str(e)}), 404

@app.route("/api/whatsapp/send", methods=["POST"])
@login_required
def send_whatsapp_web_message():
    try:
        body = request.get_json(force=True)
        req_data = json.dumps(body).encode('utf-8')
        req = urllib.request.Request("http://127.0.0.1:3001/send", data=req_data, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return jsonify(data)
    except urllib.error.HTTPError as he:
        try:
            err_data = json.loads(he.read().decode('utf-8'))
            return jsonify(err_data), he.code
        except Exception:
            return jsonify({"success": False, "error": str(he)}), he.code
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/whatsapp/logout", methods=["POST"])
@login_required
def logout_whatsapp_web():
    try:
        req = urllib.request.Request("http://127.0.0.1:3001/logout", data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return jsonify(data)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/whatsapp/messages", methods=["GET"])
@login_required
def get_whatsapp_messages():
    try:
        phone = request.args.get("phone", "")
        url = f"http://127.0.0.1:3001/messages?phone={urllib.parse.quote(phone)}&t={int(time.time()*1000)}"
        req = urllib.request.Request(url, headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return jsonify(data)
    except Exception as e:
        return jsonify({"success": False, "messages": [], "error": str(e)})

@app.route("/api/whatsapp/messages/clear", methods=["POST"])
@login_required
def clear_whatsapp_messages():
    try:
        req = urllib.request.Request("http://127.0.0.1:3001/messages/clear", data=b"{}", headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return jsonify(data)
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500

@app.route("/api/whatsapp/session-config", methods=["GET", "POST"])
@login_required
def handle_whatsapp_session_config():
    if request.method == "POST":
        try:
            body = request.get_json(force=True)
            req_data = json.dumps(body).encode('utf-8')
            req = urllib.request.Request("http://127.0.0.1:3001/session-config", data=req_data, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                
                # Also save to alert_manager channel settings
                settings = alert_manager.data.get("channel_settings", {})
                wa_set = settings.setdefault("whatsapp", {})
                if body.get("name"): wa_set["session_name"] = body["name"]
                if body.get("avatar"): wa_set["session_avatar"] = body["avatar"]
                if body.get("custom_avatar_url"): wa_set["session_avatar_url"] = body["custom_avatar_url"]
                alert_manager.save_channel_settings(settings)
                
                return jsonify(data)
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500
    else:
        try:
            req = urllib.request.Request("http://127.0.0.1:3001/session-config", headers={"Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=4) as resp:
                data = json.loads(resp.read().decode('utf-8'))
                return jsonify(data)
        except Exception as e:
            return jsonify({"success": False, "error": str(e)}), 500

if __name__ == "__main__":
    logger.info(f"Iniciando interface web em http://{Config.WEB_HOST}:{Config.WEB_PORT}")
    app.run(host=Config.WEB_HOST, port=Config.WEB_PORT, debug=False, threaded=True)


