import os
import json
import time
import socket
import smtplib
import urllib.request
import urllib.parse
import logging
import threading
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from datetime import datetime

logger = logging.getLogger(__name__)

ALERTS_FILE = os.path.join(os.path.dirname(__file__), "alerts_data.json")

DEFAULT_ALERTS_DATA = {
    "recipients": [
        {
            "id": "rec-1",
            "name": "Administrador TI / Suporte",
            "email": "admin@enging.pt",
            "phone_whatsapp": "+351912345678",
            "phone_sms": "+351912345678",
            "webhook_url": "",
            "enabled": True,
            "notes": "Contacto principal para alertas de infraestrutura"
        }
    ],
    "channel_settings": {
        "smtp": {
            "enabled": False,
            "host": "smtp.gmail.com",
            "port": 587,
            "use_tls": True,
            "username": "",
            "password": "",
            "from_email": "ups-alerts@enging.pt",
            "from_name": "Enging UPS System"
        },
        "whatsapp": {
            "enabled": False,
            "api_url": "",
            "api_token": "",
            "instance_id": "",
            "payload_format": "json_standard"  # or evolution, z-api, generic
        },
        "sms": {
            "enabled": False,
            "api_url": "",
            "api_token": "",
            "http_method": "POST"
        },
        "teams": {
            "enabled": False,
            "webhook_url": ""
        },
        "google_chat": {
            "enabled": False,
            "webhook_url": ""
        },
        "webhook": {
            "enabled": True,
            "default_url": "",
            "custom_headers": {}
        }
    },
    "rules": [
        {
            "id": "rule-on-battery",
            "name": "Falta de Energia AC (UPS em Bateria)",
            "description": "Dispara imediatamente quando a rede elétrica falha e o inversor passa para bateria.",
            "trigger_type": "on_battery",
            "threshold_val": 0,
            "threshold_val_max": 0,
            "require_duration_sec": 2,
            "cooldown_min": 10,
            "enabled": True,
            "channels": ["whatsapp", "email", "webhook"],
            "recipient_ids": ["rec-1"],
            "custom_message": ""
        },
        {
            "id": "rule-power-restored",
            "name": "Restabelecimento de Energia AC",
            "description": "Notifica quando a energia da rede retorna e a UPS volta ao modo Online normal.",
            "trigger_type": "power_restored",
            "threshold_val": 0,
            "threshold_val_max": 0,
            "require_duration_sec": 3,
            "cooldown_min": 5,
            "enabled": True,
            "channels": ["whatsapp", "email", "webhook"],
            "recipient_ids": ["rec-1"],
            "custom_message": ""
        },
        {
            "id": "rule-low-battery-30",
            "name": "Bateria Crítica (≤ 30%)",
            "description": "Alerta de emergência quando a carga da bateria atinge ou desce de 30%.",
            "trigger_type": "battery_level_low",
            "threshold_val": 30.0,
            "threshold_val_max": 0,
            "require_duration_sec": 0,
            "cooldown_min": 10,
            "enabled": True,
            "channels": ["whatsapp", "email", "sms", "webhook"],
            "recipient_ids": ["rec-1"],
            "custom_message": ""
        },
        {
            "id": "rule-high-load-80",
            "name": "Sobrecarga de Saída (Carga ≥ 80%)",
            "description": "Alerta de capacidade quando a carga consumida ultrapassa 80% do limite de 6kVA.",
            "trigger_type": "high_load",
            "threshold_val": 80.0,
            "threshold_val_max": 0,
            "require_duration_sec": 5,
            "cooldown_min": 30,
            "enabled": True,
            "channels": ["whatsapp", "email"],
            "recipient_ids": ["rec-1"],
            "custom_message": ""
        },
        {
            "id": "rule-alarm-active",
            "name": "Alarme ou Falha Interna da UPS",
            "description": "Dispara quando a UPS reporta alarme de hardware, bypass ou falha de inversor.",
            "trigger_type": "alarm_active",
            "threshold_val": 0,
            "threshold_val_max": 0,
            "require_duration_sec": 2,
            "cooldown_min": 15,
            "enabled": True,
            "channels": ["whatsapp", "email", "webhook"],
            "recipient_ids": ["rec-1"],
            "custom_message": ""
        }
    ],
    "logs": []
}


class AlertManager:
    def __init__(self, filepath=ALERTS_FILE):
        self.filepath = filepath
        self.lock = threading.Lock()
        self.state_tracking = {}  # Tracks triggers: last_triggered_time, condition_start_time, was_triggered
        self.last_status_was_on_battery = False
        self._load()

    def _load(self):
        with self.lock:
            if not os.path.exists(self.filepath):
                self._save_unlocked(DEFAULT_ALERTS_DATA)
                self.data = DEFAULT_ALERTS_DATA
            else:
                try:
                    with open(self.filepath, "r", encoding="utf-8") as f:
                        self.data = json.load(f)
                except Exception as e:
                    logger.error(f"Erro ao carregar ficheiro de alertas: {e}")
                    self.data = DEFAULT_ALERTS_DATA

    def _save(self):
        with self.lock:
            self._save_unlocked(self.data)

    def _save_unlocked(self, data):
        try:
            with open(self.filepath, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Erro ao guardar alertas: {e}")

    def get_all_data(self):
        with self.lock:
            return self.data

    # ---------------- RECIPIENTS CRUD ---------------- #

    def save_recipient(self, recipient):
        with self.lock:
            recs = self.data.setdefault("recipients", [])
            rec_id = recipient.get("id")
            if not rec_id:
                rec_id = f"rec-{int(time.time() * 1000)}"
                recipient["id"] = rec_id
                recs.append(recipient)
            else:
                idx = next((i for i, r in enumerate(recs) if r["id"] == rec_id), None)
                if idx is not None:
                    recs[idx] = recipient
                else:
                    recs.append(recipient)
            self._save_unlocked(self.data)
            return recipient

    def delete_recipient(self, rec_id):
        with self.lock:
            recs = self.data.setdefault("recipients", [])
            self.data["recipients"] = [r for r in recs if r["id"] != rec_id]
            # Remove from rules as well
            for rule in self.data.get("rules", []):
                if rec_id in rule.get("recipient_ids", []):
                    rule["recipient_ids"].remove(rec_id)
            self._save_unlocked(self.data)
            return True

    # ---------------- RULES CRUD ---------------- #

    def save_rule(self, rule):
        with self.lock:
            rules = self.data.setdefault("rules", [])
            rule_id = rule.get("id")
            if not rule_id:
                rule_id = f"rule-{int(time.time() * 1000)}"
                rule["id"] = rule_id
                rules.append(rule)
            else:
                idx = next((i for i, r in enumerate(rules) if r["id"] == rule_id), None)
                if idx is not None:
                    rules[idx] = rule
                else:
                    rules.append(rule)
            self._save_unlocked(self.data)
            return rule

    def delete_rule(self, rule_id):
        with self.lock:
            rules = self.data.setdefault("rules", [])
            self.data["rules"] = [r for r in rules if r["id"] != rule_id]
            self._save_unlocked(self.data)
            return True

    def save_channel_settings(self, settings):
        with self.lock:
            self.data["channel_settings"] = settings
            self._save_unlocked(self.data)
            return True

    # ---------------- DISPATCH & LOGS ---------------- #

    def log_notification(self, alert_name, recipient_name, channel, success, message, detail=""):
        log_entry = {
            "id": f"log-{int(time.time() * 1000)}",
            "timestamp": time.time(),
            "formatted_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "alert_name": alert_name,
            "recipient_name": recipient_name,
            "channel": channel,
            "success": success,
            "message": message,
            "detail": detail
        }
        with self.lock:
            logs = self.data.setdefault("logs", [])
            logs.insert(0, log_entry)
            if len(logs) > 300:
                self.data["logs"] = logs[:300]
            self._save_unlocked(self.data)

    def check_nut_alerts(self, nut_data):
        """Avalia todas as regras de alerta contra os dados em tempo real da UPS."""
        if not nut_data or not nut_data.get("connected"):
            return

        status = nut_data.get("status", {})
        batt = nut_data.get("battery", {})
        inp = nut_data.get("input", {})
        out = nut_data.get("output", {})

        is_on_battery = status.get("is_on_battery", False)
        is_online = status.get("is_online", False)
        has_alarm = status.get("has_alarm", False)
        batt_charge = batt.get("charge_pct", 100.0)
        batt_voltage = batt.get("voltage", 0.0)
        load_pct = out.get("load_pct", 0.0)
        input_voltage = inp.get("voltage", 0.0)

        now = time.time()
        rules = self.data.get("rules", [])

        for rule in rules:
            if not rule.get("enabled", True):
                continue

            rule_id = rule["id"]
            ttype = rule.get("trigger_type")
            thresh = float(rule.get("threshold_val", 0))
            thresh_max = float(rule.get("threshold_val_max", 0))
            cooldown_sec = rule.get("cooldown_min", 15) * 60
            req_duration = rule.get("require_duration_sec", 0)

            # Check if condition is currently active
            condition_met = False
            condition_desc = ""

            if ttype == "on_battery":
                condition_met = is_on_battery
                condition_desc = "Falta de energia elétrica! UPS está a funcionar em modo Bateria."
            elif ttype == "power_restored":
                # Dispara quando volta a ser online após ter estado em bateria
                if self.last_status_was_on_battery and is_online:
                    condition_met = True
                    condition_desc = "Energia elétrica restabelecida! UPS retornou ao modo Online."
            elif ttype == "battery_level_low":
                condition_met = batt_charge <= thresh
                condition_desc = f"Nível de bateria crítico: {batt_charge:.0f}% (Limite: ≤ {thresh:.0f}%)."
            elif ttype == "battery_voltage_low":
                condition_met = batt_voltage > 0 and batt_voltage <= thresh
                condition_desc = f"Tensão DC da bateria baixa: {batt_voltage:.1f}V (Limite: ≤ {thresh:.1f}V)."
            elif ttype == "high_load":
                condition_met = load_pct >= thresh
                condition_desc = f"Consumo de carga elevado: {load_pct:.1f}% (Limite: ≥ {thresh:.1f}%)."
            elif ttype == "input_voltage_range":
                if thresh > 0 and input_voltage < thresh:
                    condition_met = True
                    condition_desc = f"Subtensão de entrada: {input_voltage:.1f}V (Mínimo: {thresh:.1f}V)."
                elif thresh_max > 0 and input_voltage > thresh_max:
                    condition_met = True
                    condition_desc = f"Sobretensão de entrada: {input_voltage:.1f}V (Máximo: {thresh_max:.1f}V)."
            elif ttype == "alarm_active":
                condition_met = has_alarm
                condition_desc = f"Alarme detectado na UPS: {status.get('alarm_text') or status.get('raw')}."

            # State tracking per rule
            st = self.state_tracking.setdefault(rule_id, {
                "start_time": 0,
                "last_notified": 0,
                "active": False
            })

            if condition_met:
                if not st["active"]:
                    st["active"] = True
                    st["start_time"] = now

                duration = now - st["start_time"]
                time_since_last = now - st["last_notified"]

                # Fire notification if duration met and cooldown elapsed
                if duration >= req_duration and time_since_last >= cooldown_sec:
                    st["last_notified"] = now
                    # Launch dispatch in background thread
                    threading.Thread(
                        target=self._dispatch_rule_notifications,
                        args=(rule, condition_desc, nut_data),
                        daemon=True
                    ).start()
            else:
                st["active"] = False
                st["start_time"] = 0

        # Atualiza histórico de modo bateria
        self.last_status_was_on_battery = is_on_battery

    def _dispatch_rule_notifications(self, rule, condition_desc, nut_data):
        """Envia alertas para todos os destinatários e canais configurados na regra, sem qualquer duplicação."""
        rec_ids = rule.get("recipient_ids", [])
        channels = rule.get("channels", [])
        recipients = [r for r in self.data.get("recipients", []) if r.get("id") in rec_ids and r.get("enabled", True)]
        settings = self.data.get("channel_settings", {})

        subject = f"[ALERTA UPS] {rule.get('name', 'Alerta')} - Enging UPS System"
        body_text = self._build_alert_message(rule, condition_desc, nut_data)

        sent_emails = set()
        sent_whatsapps = set()
        sent_sms = set()
        sent_teams = set()
        sent_gchats = set()
        sent_webhooks = set()

        # 1. Canais pessoais por destinatário (Email, WhatsApp, SMS e webhooks privados)
        for rec in recipients:
            for ch in channels:
                if ch == "email":
                    target = (rec.get("email") or "").strip()
                    if target and target.lower() not in sent_emails:
                        sent_emails.add(target.lower())
                        self.send_email_notification(rec, subject, body_text, rule["name"], settings.get("smtp", {}))

                elif ch == "whatsapp":
                    target = (rec.get("phone_whatsapp") or "").strip()
                    if target and target not in sent_whatsapps:
                        sent_whatsapps.add(target)
                        self.send_whatsapp_notification(rec, body_text, rule["name"], settings.get("whatsapp", {}))

                elif ch == "sms":
                    target = (rec.get("phone_sms") or "").strip()
                    if target and target not in sent_sms:
                        sent_sms.add(target)
                        self.send_sms_notification(rec, body_text, rule["name"], settings.get("sms", {}))

                elif ch == "teams":
                    rec_teams_url = (rec.get("teams_webhook") or rec.get("webhook_teams") or "").strip()
                    if rec_teams_url and rec_teams_url not in sent_teams:
                        sent_teams.add(rec_teams_url)
                        self.send_teams_notification(rec, rec_teams_url, rule["name"], body_text, condition_desc, nut_data, settings.get("teams", {}))

                elif ch in ("google_chat", "google"):
                    rec_gc_url = (rec.get("google_chat_webhook") or rec.get("webhook_google") or "").strip()
                    if rec_gc_url and rec_gc_url not in sent_gchats:
                        sent_gchats.add(rec_gc_url)
                        self.send_google_chat_notification(rec, rec_gc_url, rule["name"], body_text, condition_desc, nut_data, settings.get("google_chat", {}))

                elif ch == "webhook":
                    rec_wh_url = (rec.get("webhook_url") or "").strip()
                    if rec_wh_url and rec_wh_url not in sent_webhooks:
                        sent_webhooks.add(rec_wh_url)
                        self.send_webhook_notification(rec, rec_wh_url, rule, condition_desc, nut_data)

        # 2. Gateways globais de canal (Microsoft Teams, Google Chat e Webhook Geral) - Disparo ÚNICO por evento
        if "teams" in channels:
            teams_cfg = settings.get("teams", {})
            global_teams_url = (teams_cfg.get("webhook_url") or "").strip()
            if teams_cfg.get("enabled", True) and global_teams_url and global_teams_url not in sent_teams:
                sent_teams.add(global_teams_url)
                self.send_teams_notification(None, global_teams_url, rule["name"], body_text, condition_desc, nut_data, teams_cfg)

        if "google_chat" in channels or "google" in channels:
            gc_cfg = settings.get("google_chat", {})
            global_gc_url = (gc_cfg.get("webhook_url") or "").strip()
            if gc_cfg.get("enabled", True) and global_gc_url and global_gc_url not in sent_gchats:
                sent_gchats.add(global_gc_url)
                self.send_google_chat_notification(None, global_gc_url, rule["name"], body_text, condition_desc, nut_data, gc_cfg)

        if "webhook" in channels:
            wh_cfg = settings.get("webhook", {})
            global_wh_url = (wh_cfg.get("default_url") or "").strip()
            if wh_cfg.get("enabled", True) and global_wh_url and global_wh_url not in sent_webhooks:
                sent_webhooks.add(global_wh_url)
                self.send_webhook_notification(None, global_wh_url, rule, condition_desc, nut_data)

    def _build_alert_message(self, rule, condition_desc, nut_data):
        now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        status = nut_data.get("status", {})
        batt = nut_data.get("battery", {})
        inp = nut_data.get("input", {})
        out = nut_data.get("output", {})

        custom = rule.get("custom_message", "").strip()
        
        # If user provided a full custom message or template with variables
        if custom and ("{evento}" in custom or "{detalhe}" in custom or "🚨" in custom or "ALERTA" in custom or len(custom.splitlines()) > 1 or "{" in custom):
            msg = custom
            msg = msg.replace("{evento}", rule.get("name", "Alerta UPS"))
            msg = msg.replace("{rule_name}", rule.get("name", "Alerta UPS"))
            msg = msg.replace("{detalhe}", condition_desc)
            msg = msg.replace("{condition}", condition_desc)
            msg = msg.replace("{hora}", now_str)
            msg = msg.replace("{time}", now_str)
            msg = msg.replace("{bateria}", f"{batt.get('charge_pct', 0):.0f}%")
            msg = msg.replace("{tensao_bat}", f"{batt.get('voltage', 0):.1f} V")
            msg = msg.replace("{tensao_in}", f"{inp.get('voltage', 0):.1f} V")
            msg = msg.replace("{freq_in}", f"{inp.get('frequency', 0):.1f} Hz")
            msg = msg.replace("{tensao_out}", f"{out.get('voltage', 0):.1f} V")
            msg = msg.replace("{carga}", f"{out.get('load_pct', 0):.1f}%")
            msg = msg.replace("{potencia}", f"{out.get('real_power_w', 0):.0f} W")
            msg = msg.replace("{modo}", status.get("label", "NORMAL").upper())
            msg = msg.replace("{servidor}", "10.255.255.28 (INVT HT1106XS)")
            msg = msg.replace("{painel_url}", "https://10.255.255.28/")
            return msg
        elif custom:
            custom_part = f"\n📝 Observação: {custom}\n"
        else:
            custom_part = ""

        msg = (
            f"🚨 *ALERTA ENGING UPS SYSTEM* 🚨\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n"
            f"📌 *Evento:* {rule['name']}\n"
            f"⚠️ *Detalhe:* {condition_desc}\n"
            f"{custom_part}"
            f"🕒 *Hora:* {now_str}\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n"
            f"🔋 *Bateria:* {batt.get('charge_pct', 0):.0f}% ({batt.get('voltage', 0):.1f} V)\n"
            f"⚡ *Entrada AC:* {inp.get('voltage', 0):.1f} V ({inp.get('frequency', 0):.1f} Hz)\n"
            f"🔌 *Saída UPS:* {out.get('voltage', 0):.1f} V | Carga: {out.get('load_pct', 0):.1f}% ({out.get('real_power_w', 0):.0f} W)\n"
            f"📊 *Modo:* {status.get('label', 'NORMAL').upper()}\n"
            f"🖥️ *Servidor:* 10.255.255.28 (INVT HT1106XS)\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n"
            f"Painel: https://10.255.255.28/"
        )
        return msg

    # ---------------- DISPATCH CHANNELS ---------------- #

    def send_email_notification(self, rec, subject, body_text, alert_name, smtp_cfg):
        t0 = time.time()
        target = rec.get("email", "").strip() if rec else ""
        if not target:
            res = {
                "success": False,
                "channel": "email",
                "target": "",
                "message": "Destinatário sem endereço de e-mail definido.",
                "detail": "Preencha o campo de e-mail do contato.",
                "latency_ms": 0
            }
            self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "email", False, res["message"], res["detail"])
            return res

        if not smtp_cfg or not smtp_cfg.get("enabled"):
            res = {
                "success": False,
                "channel": "email",
                "target": target,
                "message": "Canal SMTP desativado nas configurações globais.",
                "detail": "Aceda a Conexões > Gateways e ative o Servidor SMTP.",
                "latency_ms": 0
            }
            self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "email", False, res["message"], res["detail"])
            return res

        host = smtp_cfg.get("host", "smtp.gmail.com")
        port = int(smtp_cfg.get("port", 587))
        use_tls = smtp_cfg.get("use_tls", True)
        user = smtp_cfg.get("username", "").strip()
        password = smtp_cfg.get("password", "")
        from_email = smtp_cfg.get("from_email", user or "alerts@enging.pt").strip()
        from_name = smtp_cfg.get("from_name", "Enging UPS System").strip()

        try:
            msg = MIMEMultipart()
            msg["From"] = f"{from_name} <{from_email}>"
            msg["To"] = target
            msg["Subject"] = subject
            msg.attach(MIMEText(body_text, "plain", "utf-8"))

            server = smtplib.SMTP(host, port, timeout=10)
            if use_tls:
                server.starttls()
            if user and password:
                server.login(user, password)
            server.sendmail(from_email, [target], msg.as_string())
            server.quit()

            latency = int((time.time() - t0) * 1000)
            res = {
                "success": True,
                "channel": "email",
                "target": target,
                "message": f"E-mail transmitido com sucesso para {target}",
                "detail": f"Servidor SMTP {host}:{port} respondeu com êxito em {latency}ms.",
                "latency_ms": latency
            }
            self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "email", True, res["message"], res["detail"])
            return res

        except smtplib.SMTPAuthenticationError as auth_err:
            latency = int((time.time() - t0) * 1000)
            err_msg = "Falha de autenticação SMTP. Verifique o utilizador e senha (para contas Google, utilize uma Senha de Aplicação de 16 dígitos)."
            res = {"success": False, "channel": "email", "target": target, "message": err_msg, "detail": str(auth_err), "latency_ms": latency}
            self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "email", False, err_msg, str(auth_err))
            return res
        except (socket.timeout, smtplib.SMTPConnectError, ConnectionRefusedError) as conn_err:
            latency = int((time.time() - t0) * 1000)
            err_msg = f"Tempo esgotado ou ligação recusada ao contactar {host}:{port}."
            res = {"success": False, "channel": "email", "target": target, "message": err_msg, "detail": str(conn_err), "latency_ms": latency}
            self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "email", False, err_msg, str(conn_err))
            return res
        except Exception as e:
            latency = int((time.time() - t0) * 1000)
            res = {"success": False, "channel": "email", "target": target, "message": f"Falha no envio de e-mail para {target}", "detail": str(e), "latency_ms": latency}
            self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "email", False, res["message"], str(e))
            return res

    def send_whatsapp_notification(self, rec, body_text, alert_name, wa_cfg):
        t0 = time.time()
        phone = rec.get("phone_whatsapp", "").strip() if rec else ""
        if not phone:
            res = {
                "success": False,
                "channel": "whatsapp",
                "target": "",
                "message": "Destinatário sem número de WhatsApp definido.",
                "detail": "Preencha o telemóvel do contato com indicativo internacional (ex: +351...).",
                "latency_ms": 0
            }
            self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "whatsapp", False, res["message"], res["detail"])
            return res

        # 1. Primeiro tenta o serviço WhatsApp Web nativo (Baileys em 127.0.0.1:3001)
        wa_web_error_detail = ""
        try:
            req_data = json.dumps({"phone": phone, "message": body_text}).encode("utf-8")
            req = urllib.request.Request("http://127.0.0.1:3001/send", data=req_data, headers={"Content-Type": "application/json"}, method="POST")
            with urllib.request.urlopen(req, timeout=12) as resp:
                status_code = resp.getcode()
                raw_resp = resp.read().decode("utf-8")
                resp_json = json.loads(raw_resp) if raw_resp else {}
                latency = int((time.time() - t0) * 1000)

                if status_code == 200 and resp_json.get("success"):
                    msg_id = resp_json.get("messageId", "OK")
                    res = {
                        "success": True,
                        "channel": "whatsapp",
                        "target": phone,
                        "message": f"Mensagem transmitida via WhatsApp Web para {phone}",
                        "detail": f"ID da mensagem: {msg_id} (Latência: {latency}ms)",
                        "messageId": msg_id,
                        "latency_ms": latency
                    }
                    self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "whatsapp", True, res["message"], res["detail"])
                    return res
        except urllib.error.HTTPError as he:
            err_body = he.read().decode("utf-8") if he.fp else ""
            try:
                err_json = json.loads(err_body)
                wa_web_error_detail = err_json.get("error", err_body)
            except Exception:
                wa_web_error_detail = err_body or str(he)
            logger.warning(f"WhatsApp Web HTTP {he.code}: {wa_web_error_detail}")
        except Exception as e:
            wa_web_error_detail = str(e)
            logger.warning(f"WhatsApp Web local em 127.0.0.1:3001 erro: {e}")

        # 2. Fallback para API / Webhook externa se configurada
        api_url = wa_cfg.get("api_url", "").strip() if wa_cfg else ""
        if wa_cfg and wa_cfg.get("enabled") and api_url:
            try:
                payload = {
                    "number": phone.replace("+", "").replace(" ", "").replace("-", ""),
                    "text": body_text,
                    "message": body_text,
                    "recipient": rec.get("name", "") if rec else ""
                }
                headers = {"Content-Type": "application/json"}
                if wa_cfg.get("api_token"):
                    headers["Authorization"] = f"Bearer {wa_cfg['api_token']}"
                    headers["apikey"] = wa_cfg["api_token"]

                req = urllib.request.Request(api_url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
                with urllib.request.urlopen(req, timeout=12) as resp:
                    status_code = resp.getcode()
                    latency = int((time.time() - t0) * 1000)
                    if 200 <= status_code < 300:
                        res = {
                            "success": True,
                            "channel": "whatsapp",
                            "target": phone,
                            "message": f"Mensagem enviada via API Gateway WhatsApp para {phone}",
                            "detail": f"Servidor remoto HTTP {status_code} ({latency}ms)",
                            "latency_ms": latency
                        }
                        self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "whatsapp", True, res["message"], res["detail"])
                        return res
                    else:
                        res = {
                            "success": False,
                            "channel": "whatsapp",
                            "target": phone,
                            "message": f"Erro retornado pela API Gateway WhatsApp (HTTP {status_code})",
                            "detail": f"Código de estado: {status_code}",
                            "latency_ms": latency
                        }
                        self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "whatsapp", False, res["message"], res["detail"])
                        return res
            except Exception as e:
                latency = int((time.time() - t0) * 1000)
                res = {
                    "success": False,
                    "channel": "whatsapp",
                    "target": phone,
                    "message": f"Falha de conexão com a API Gateway WhatsApp ({api_url})",
                    "detail": str(e),
                    "latency_ms": latency
                }
                self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "whatsapp", False, res["message"], res["detail"])
                return res

        latency = int((time.time() - t0) * 1000)
        res = {
            "success": False,
            "channel": "whatsapp",
            "target": phone,
            "message": "WhatsApp Web não conectado ou sessão desconectada.",
            "detail": wa_web_error_detail or "Aceda a Conexões > WhatsApp e aponte a câmara para ler o QR Code de autenticação.",
            "latency_ms": latency
        }
        self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "whatsapp", False, res["message"], res["detail"])
        return res

    def send_teams_notification(self, rec, webhook_url, rule_name, body_text, condition_desc, nut_data, teams_cfg=None):
        t0 = time.time()
        target = webhook_url or (teams_cfg.get("webhook_url") if teams_cfg else "")
        target = (target or "").strip()
        
        if not target:
            res = {
                "success": False,
                "channel": "teams",
                "target": "",
                "message": "Nenhum URL do Microsoft Teams configurado.",
                "detail": "Configure a URL do Incoming Webhook ou Power Automate Workflow do Teams em Conexões > Gateways.",
                "latency_ms": 0
            }
            self.log_notification(rule_name, rec.get("name", "Canal Teams") if rec else "Canal Teams", "teams", False, res["message"], res["detail"])
            return res

        batt = nut_data.get("battery", {}) if nut_data else {}
        inp = nut_data.get("input", {}) if nut_data else {}
        out = nut_data.get("output", {}) if nut_data else {}
        status = nut_data.get("status", {}) if nut_data else {}
        now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

        format_mode = (teams_cfg.get("payload_format") if teams_cfg else "adaptive_card") or "adaptive_card"

        # 1. Payload Nativo AdaptiveCard 1.4 (Padrão Oficial do Power Automate / Workflows do Teams)
        adaptive_card = {
            "type": "AdaptiveCard",
            "$schema": "http://adaptivecards.io/schemas/adaptive-card.json",
            "version": "1.4",
            "body": [
                {
                    "type": "Container",
                    "items": [
                        {
                            "type": "TextBlock",
                            "text": f"🚨 [ALERTA ENGING UPS] {rule_name}",
                            "weight": "Bolder",
                            "size": "Medium",
                            "color": "Attention" if ("Crítica" in rule_name or "Falta" in rule_name or "Sobrecarga" in rule_name) else "Default",
                            "wrap": True
                        },
                        {
                            "type": "TextBlock",
                            "text": body_text,
                            "wrap": True,
                            "spacing": "Small"
                        }
                    ]
                },
                {
                    "type": "FactSet",
                    "facts": [
                        {"title": "📌 Evento:", "value": str(rule_name)},
                        {"title": "⚠️ Detalhe:", "value": str(condition_desc or "Notificação do Sistema")},
                        {"title": "🔋 Bateria:", "value": f"{batt.get('charge_pct', 0):.0f}% ({batt.get('voltage', 0):.1f} V)"},
                        {"title": "⚡ Entrada AC:", "value": f"{inp.get('voltage', 0):.1f} V ({inp.get('frequency', 0):.1f} Hz)"},
                        {"title": "🔌 Saída UPS:", "value": f"{out.get('voltage', 0):.1f} V | Carga: {out.get('load_pct', 0):.1f}% ({out.get('real_power_w', 0):.0f} W)"},
                        {"title": "📊 Estado:", "value": str(status.get('label', 'NORMAL')).upper()},
                        {"title": "🖥️ Servidor:", "value": "10.255.255.28 (INVT HT1106XS)"},
                        {"title": "🕒 Data/Hora:", "value": now_str}
                    ]
                }
            ],
            "actions": [
                {
                    "type": "Action.OpenUrl",
                    "title": "🌐 Abrir Dashboard Enging",
                    "url": "https://10.255.255.28/"
                }
            ]
        }

        # 2. Payload MessageCard (Legacy O365 Connector)
        legacy_card = {
            "@type": "MessageCard",
            "@context": "http://schema.org/extensions",
            "themeColor": "E95C0C",
            "summary": f"🚨 [ALERTA ENGING UPS] {rule_name}",
            "title": f"🚨 [ALERTA ENGING UPS] {rule_name}",
            "text": body_text.replace("\n", "\n\n"),
            "sections": [{
                "activityTitle": "Enging UPS System • INVT HT1106XS",
                "activitySubtitle": f"Data/Hora: {now_str}",
                "facts": [
                    {"name": "Evento:", "value": str(rule_name)},
                    {"name": "Detalhe:", "value": str(condition_desc or "Notificação do Sistema")},
                    {"name": "Bateria:", "value": f"{batt.get('charge_pct', 0):.0f}% ({batt.get('voltage', 0):.1f} V)"},
                    {"name": "Entrada AC:", "value": f"{inp.get('voltage', 0):.1f} V ({inp.get('frequency', 0):.1f} Hz)"},
                    {"name": "Saída UPS:", "value": f"{out.get('voltage', 0):.1f} V | Carga: {out.get('load_pct', 0):.1f}% ({out.get('real_power_w', 0):.0f} W)"},
                    {"name": "Estado:", "value": str(status.get('label', 'NORMAL')).upper()},
                    {"name": "Servidor:", "value": "10.255.255.28 (INVT HT1106XS)"}
                ]
            }],
            "potentialAction": [{
                "@type": "OpenUri",
                "name": "Abrir Dashboard Enging",
                "targets": [{"os": "default", "uri": "https://10.255.255.28/"}]
            }]
        }

        # 3. Payload Attachments Wrapper
        attachments_card = {
            "type": "message",
            "attachments": [
                {
                    "contentType": "application/vnd.microsoft.card.adaptive",
                    "contentUrl": None,
                    "content": adaptive_card
                }
            ]
        }

        if format_mode == "message_card":
            primary_payload = legacy_card
        elif format_mode == "attachments":
            primary_payload = attachments_card
        elif format_mode == "simple_text":
            primary_payload = {"text": f"🚨 *[ALERTA ENGING UPS] {rule_name}*\n\n{body_text}"}
        else:
            # Default: Adaptive Card direto para Power Automate Workflows
            primary_payload = adaptive_card

        def _do_post(p_body):
            req_data = json.dumps(p_body).encode("utf-8")
            headers = {"Content-Type": "application/json", "User-Agent": "Enging-UPS-Notifier/2.0"}
            req = urllib.request.Request(target, data=req_data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.getcode()

        try:
            status_code = _do_post(primary_payload)
            latency = int((time.time() - t0) * 1000)
            if 200 <= status_code < 300:
                res = {
                    "success": True,
                    "channel": "teams",
                    "target": target,
                    "message": "Notificação transmitida com sucesso para o Microsoft Teams.",
                    "detail": f"Power Automate respondeu HTTP {status_code} ({latency}ms) no formato {format_mode}",
                    "latency_ms": latency
                }
                self.log_notification(rule_name, rec.get("name", "Canal Teams") if rec else "Canal Teams", "teams", True, res["message"], res["detail"])
                return res
        except urllib.error.HTTPError as he:
            # Fallback 1: se tentou Adaptive Card e deu 400, tenta attachments ou legacy_card
            try:
                fallback_payload = attachments_card if format_mode != "attachments" else legacy_card
                status_code = _do_post(fallback_payload)
                latency = int((time.time() - t0) * 1000)
                if 200 <= status_code < 300:
                    res = {
                        "success": True,
                        "channel": "teams",
                        "target": target,
                        "message": "Notificação transmitida para o Microsoft Teams (Fallback).",
                        "detail": f"Canal respondeu HTTP {status_code} ({latency}ms)",
                        "latency_ms": latency
                    }
                    self.log_notification(rule_name, rec.get("name", "Canal Teams") if rec else "Canal Teams", "teams", True, res["message"], res["detail"])
                    return res
            except Exception:
                pass

            # Fallback 2: texto simples
            try:
                simple_payload = {"text": f"🚨 [ALERTA ENGING UPS] {rule_name}\n\n{body_text}"}
                status_code = _do_post(simple_payload)
                latency = int((time.time() - t0) * 1000)
                if 200 <= status_code < 300:
                    res = {
                        "success": True,
                        "channel": "teams",
                        "target": target,
                        "message": "Mensagem transmitida para o Microsoft Teams (Texto).",
                        "detail": f"Canal respondeu HTTP {status_code} ({latency}ms)",
                        "latency_ms": latency
                    }
                    self.log_notification(rule_name, rec.get("name", "Canal Teams") if rec else "Canal Teams", "teams", True, res["message"], res["detail"])
                    return res
            except Exception:
                pass

            latency = int((time.time() - t0) * 1000)
            res = {
                "success": False,
                "channel": "teams",
                "target": target,
                "message": f"Erro HTTP {he.code} ao transmitir para o Microsoft Teams",
                "detail": str(he),
                "latency_ms": latency
            }
            self.log_notification(rule_name, rec.get("name", "Canal Teams") if rec else "Canal Teams", "teams", False, res["message"], str(he))
            return res
        except Exception as e:
            latency = int((time.time() - t0) * 1000)
            res = {
                "success": False,
                "channel": "teams",
                "target": target,
                "message": "Falha na conexão com o Microsoft Teams Webhook.",
                "detail": str(e),
                "latency_ms": latency
            }
            self.log_notification(rule_name, rec.get("name", "Canal Teams") if rec else "Canal Teams", "teams", False, res["message"], str(e))
            return res

    def send_google_chat_notification(self, rec, webhook_url, rule_name, body_text, condition_desc, nut_data, gchat_cfg=None):
        t0 = time.time()
        target = webhook_url or (gchat_cfg.get("webhook_url") if gchat_cfg else "")
        target = (target or "").strip()
        
        if not target:
            res = {
                "success": False,
                "channel": "google_chat",
                "target": "",
                "message": "Nenhum URL do Google Chat configurado.",
                "detail": "Configure a URL do Webhook do espaço do Google Chat em Conexões > Gateways.",
                "latency_ms": 0
            }
            self.log_notification(rule_name, rec.get("name", "Espaço Google Chat") if rec else "Espaço Google Chat", "google_chat", False, res["message"], res["detail"])
            return res

        batt = nut_data.get("battery", {}) if nut_data else {}
        inp = nut_data.get("input", {}) if nut_data else {}
        out = nut_data.get("output", {}) if nut_data else {}
        status = nut_data.get("status", {}) if nut_data else {}
        now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

        # Payload para Google Chat (CardsV2)
        payload = {
            "text": body_text,
            "cardsV2": [{
                "cardId": "ups-alert-card",
                "card": {
                    "header": {
                        "title": f"🚨 ALERTA ENGING UPS: {rule_name}",
                        "subtitle": f"Disparo em {now_str}",
                        "imageType": "CIRCLE"
                    },
                    "sections": [{
                        "header": "Diagnóstico & Telemetria em Tempo Real",
                        "widgets": [
                            {"textParagraph": {"text": f"<b>Condição:</b> {condition_desc or 'Alerta do Sistema'}"}},
                            {"decoratedText": {"topLabel": "Bateria", "text": f"{batt.get('charge_pct', 0):.0f}% ({batt.get('voltage', 0):.1f} V)", "startIcon": {"knownIcon": "STAR"}}},
                            {"decoratedText": {"topLabel": "Rede Elétrica (Entrada → Saída)", "text": f"{inp.get('voltage', 0):.1f}V → {out.get('voltage', 0):.1f}V (Carga: {out.get('load_pct', 0):.1f}%)"}},
                            {"decoratedText": {"topLabel": "Modo Operacional", "text": str(status.get('label', 'NORMAL')).upper()}},
                            {"buttonList": {"buttons": [{"text": "Abrir Dashboard Enging UPS", "onClick": {"openLink": {"url": "https://10.255.255.28/"}}}]}}
                        ]
                    }]
                }
            }]
        }

        try:
            req_data = json.dumps(payload).encode("utf-8")
            headers = {"Content-Type": "application/json", "User-Agent": "Enging-UPS-Notifier/2.0"}
            req = urllib.request.Request(target, data=req_data, headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                status_code = resp.getcode()
                latency = int((time.time() - t0) * 1000)
                if 200 <= status_code < 300:
                    res = {
                        "success": True,
                        "channel": "google_chat",
                        "target": target,
                        "message": "Mensagem transmitida com sucesso para o Google Chat.",
                        "detail": f"Google Chat Space respondeu HTTP {status_code} ({latency}ms)",
                        "latency_ms": latency
                    }
                    self.log_notification(rule_name, rec.get("name", "Espaço Google Chat") if rec else "Espaço Google Chat", "google_chat", True, res["message"], res["detail"])
                    return res
        except urllib.error.HTTPError as he:
            # Fallback para payload simples de texto se cardsV2 falhar
            try:
                simple_payload = json.dumps({"text": body_text}).encode("utf-8")
                req2 = urllib.request.Request(target, data=simple_payload, headers={"Content-Type": "application/json"}, method="POST")
                with urllib.request.urlopen(req2, timeout=10) as resp2:
                    status_code = resp2.getcode()
                    latency = int((time.time() - t0) * 1000)
                    if 200 <= status_code < 300:
                        res = {
                            "success": True,
                            "channel": "google_chat",
                            "target": target,
                            "message": "Mensagem transmitida com sucesso para o Google Chat (Modo Texto).",
                            "detail": f"Espaço respondeu HTTP {status_code} ({latency}ms)",
                            "latency_ms": latency
                        }
                        self.log_notification(rule_name, rec.get("name", "Espaço Google Chat") if rec else "Espaço Google Chat", "google_chat", True, res["message"], res["detail"])
                        return res
            except Exception:
                pass

            latency = int((time.time() - t0) * 1000)
            res = {
                "success": False,
                "channel": "google_chat",
                "target": target,
                "message": f"Erro HTTP {he.code} ao disparar Google Chat Webhook",
                "detail": str(he),
                "latency_ms": latency
            }
            self.log_notification(rule_name, rec.get("name", "Espaço Google Chat") if rec else "Espaço Google Chat", "google_chat", False, res["message"], str(he))
            return res
        except Exception as e:
            latency = int((time.time() - t0) * 1000)
            res = {
                "success": False,
                "channel": "google_chat",
                "target": target,
                "message": "Falha na conexão com o Google Chat Webhook.",
                "detail": str(e),
                "latency_ms": latency
            }
            self.log_notification(rule_name, rec.get("name", "Espaço Google Chat") if rec else "Espaço Google Chat", "google_chat", False, res["message"], str(e))
            return res

    def send_webhook_notification(self, rec, webhook_url, rule, condition_desc, nut_data):
        t0 = time.time()
        if not webhook_url:
            res = {
                "success": False,
                "channel": "webhook",
                "target": "",
                "message": "Nenhum URL de Webhook definido.",
                "detail": "Configure a URL de destino do Webhook nas configurações do canal ou no contato.",
                "latency_ms": 0
            }
            self.log_notification(rule.get("name", "Webhook"), rec.get("name", "Contato") if rec else "Contato", "webhook", False, res["message"], res["detail"])
            return res

        try:
            payload = {
                "event": "ups_alert",
                "alert_name": rule.get("name", "Alerta UPS"),
                "rule_id": rule.get("id", "test"),
                "trigger_type": rule.get("trigger_type", "manual_test"),
                "condition": condition_desc,
                "timestamp": time.time(),
                "formatted_time": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "recipient": {
                    "id": rec.get("id", "") if rec else "",
                    "name": rec.get("name", "") if rec else "",
                    "email": rec.get("email", "") if rec else "",
                    "phone": rec.get("phone_whatsapp", "") if rec else ""
                },
                "ups_telemetry": {
                    "status": nut_data.get("status", {}) if nut_data else {},
                    "battery": nut_data.get("battery", {}) if nut_data else {},
                    "input": nut_data.get("input", {}) if nut_data else {},
                    "output": nut_data.get("output", {}) if nut_data else {}
                }
            }
            headers = {"Content-Type": "application/json", "User-Agent": "Enging-UPS-Notifier/2.0"}
            req = urllib.request.Request(webhook_url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                status_code = resp.getcode()
                latency = int((time.time() - t0) * 1000)
                if 200 <= status_code < 300:
                    res = {
                        "success": True,
                        "channel": "webhook",
                        "target": webhook_url,
                        "message": f"Webhook transmitido com sucesso para {webhook_url}",
                        "detail": f"Endpoint remoto respondeu HTTP {status_code} ({latency}ms)",
                        "latency_ms": latency
                    }
                    self.log_notification(rule.get("name", "Webhook"), rec.get("name", "Contato") if rec else "Contato", "webhook", True, res["message"], res["detail"])
                    return res
                else:
                    res = {
                        "success": False,
                        "channel": "webhook",
                        "target": webhook_url,
                        "message": f"Webhook respondeu com código de erro HTTP {status_code}",
                        "detail": f"Endpoint: {webhook_url}",
                        "latency_ms": latency
                    }
                    self.log_notification(rule.get("name", "Webhook"), rec.get("name", "Contato") if rec else "Contato", "webhook", False, res["message"], res["detail"])
                    return res
        except urllib.error.HTTPError as he:
            latency = int((time.time() - t0) * 1000)
            res = {
                "success": False,
                "channel": "webhook",
                "target": webhook_url,
                "message": f"Erro HTTP {he.code} ao disparar Webhook",
                "detail": str(he),
                "latency_ms": latency
            }
            self.log_notification(rule.get("name", "Webhook"), rec.get("name", "Contato") if rec else "Contato", "webhook", False, res["message"], str(he))
            return res
        except Exception as e:
            latency = int((time.time() - t0) * 1000)
            res = {
                "success": False,
                "channel": "webhook",
                "target": webhook_url,
                "message": f"Falha na entrega do Webhook ({webhook_url})",
                "detail": str(e),
                "latency_ms": latency
            }
            self.log_notification(rule.get("name", "Webhook"), rec.get("name", "Contato") if rec else "Contato", "webhook", False, res["message"], str(e))
            return res

    def send_sms_notification(self, rec, body_text, alert_name, sms_cfg):
        t0 = time.time()
        phone = rec.get("phone_sms", "").strip() if rec else ""
        if not phone:
            res = {
                "success": False,
                "channel": "sms",
                "target": "",
                "message": "Destinatário sem número de SMS definido.",
                "detail": "Preencha o telemóvel do contato.",
                "latency_ms": 0
            }
            self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "sms", False, res["message"], res["detail"])
            return res

        api_url = sms_cfg.get("api_url", "").strip() if sms_cfg else ""
        if not sms_cfg or not sms_cfg.get("enabled") or not api_url:
            res = {
                "success": False,
                "channel": "sms",
                "target": phone,
                "message": "Gateway SMS não configurado ou desativado.",
                "detail": "Configure a URL da API do SMS em Conexões > Gateways.",
                "latency_ms": 0
            }
            self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "sms", False, res["message"], res["detail"])
            return res

        try:
            payload = {
                "to": phone,
                "message": body_text[:160]
            }
            headers = {"Content-Type": "application/json"}
            if sms_cfg.get("api_token"):
                headers["Authorization"] = f"Bearer {sms_cfg['api_token']}"

            req = urllib.request.Request(api_url, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")
            with urllib.request.urlopen(req, timeout=10) as resp:
                status_code = resp.getcode()
                latency = int((time.time() - t0) * 1000)
                if 200 <= status_code < 300:
                    res = {
                        "success": True,
                        "channel": "sms",
                        "target": phone,
                        "message": f"SMS enviado com sucesso para {phone}",
                        "detail": f"Resposta HTTP {status_code} ({latency}ms)",
                        "latency_ms": latency
                    }
                    self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "sms", True, res["message"], res["detail"])
                    return res
                else:
                    res = {
                        "success": False,
                        "channel": "sms",
                        "target": phone,
                        "message": f"Gateway SMS respondeu com código de erro HTTP {status_code}",
                        "detail": f"Endpoint: {api_url}",
                        "latency_ms": latency
                    }
                    self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "sms", False, res["message"], res["detail"])
                    return res
        except Exception as e:
            latency = int((time.time() - t0) * 1000)
            res = {
                "success": False,
                "channel": "sms",
                "target": phone,
                "message": f"Falha ao enviar SMS para {phone}",
                "detail": str(e),
                "latency_ms": latency
            }
            self.log_notification(alert_name, rec.get("name", "Contato") if rec else "Contato", "sms", False, res["message"], str(e))
            return res

    def test_notification_channel(self, channel, recipient_id, custom_target=""):
        """Dispara uma notificação de teste em tempo real para validar a entrega no canal."""
        rec = next((r for r in self.data.get("recipients", []) if r["id"] == recipient_id), None)
        if not rec:
            rec = {
                "id": "test",
                "name": "Utilizador de Teste",
                "email": custom_target or "admin@enging.pt",
                "phone_whatsapp": custom_target or "+351912345678",
                "phone_sms": custom_target or "+351912345678",
                "webhook_teams": custom_target,
                "webhook_google": custom_target,
                "webhook_url": custom_target
            }

        settings = self.data.get("channel_settings", {})
        now_str = datetime.now().strftime("%d/%m/%Y %H:%M:%S")
        test_msg = (
            f"🔔 *TESTE DE NOTIFICAÇÃO - ENGING UPS SYSTEM*\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n"
            f"Canal testado: *{channel.upper()}*\n"
            f"Destinatário: *{rec.get('name', 'Utilizador de Teste')}*\n"
            f"Hora: {now_str}\n"
            f"Servidor: 10.255.255.28 (INVT HT1106XS)\n"
            f"━━━━━━━━━━━━━━━━━━━━━━\n"
            f"Se você recebeu esta mensagem, a comunicação com o gateway está 100% operacional! ✅"
        )

        dummy_rule = {"id": "test", "name": f"Teste de {channel.upper()}", "trigger_type": "manual_test"}
        dummy_data = {"status": {"label": "ONLINE", "is_online": True}, "battery": {"charge_pct": 100, "voltage": 220.0}, "input": {"voltage": 230.0, "frequency": 50.0}, "output": {"voltage": 230.0, "load_pct": 18, "real_power_w": 1080}}

        if channel == "email":
            target = custom_target or rec.get("email")
            rec["email"] = target
            return self.send_email_notification(rec, "[TESTE] Notificação Enging UPS System", test_msg, "Teste de Canal", settings.get("smtp", {}))
        elif channel == "whatsapp":
            target = custom_target or rec.get("phone_whatsapp")
            rec["phone_whatsapp"] = target
            return self.send_whatsapp_notification(rec, test_msg, "Teste de Canal", settings.get("whatsapp", {}))
        elif channel == "teams":
            target = custom_target or rec.get("webhook_teams") or settings.get("teams", {}).get("webhook_url")
            return self.send_teams_notification(rec, target, "Teste Microsoft Teams", test_msg, "Disparo de teste manual", dummy_data, settings.get("teams", {}))
        elif channel in ("google_chat", "google"):
            target = custom_target or rec.get("webhook_google") or settings.get("google_chat", {}).get("webhook_url")
            return self.send_google_chat_notification(rec, target, "Teste Google Chat", test_msg, "Disparo de teste manual", dummy_data, settings.get("google_chat", {}))
        elif channel == "webhook":
            target = custom_target or rec.get("webhook_url") or settings.get("webhook", {}).get("default_url")
            return self.send_webhook_notification(rec, target, dummy_rule, "Disparo de teste manual", dummy_data)
        elif channel == "sms":
            target = custom_target or rec.get("phone_sms")
            rec["phone_sms"] = target
            return self.send_sms_notification(rec, test_msg, "Teste de Canal", settings.get("sms", {}))
        return {
            "success": False,
            "channel": channel,
            "target": custom_target,
            "message": f"Canal desconhecido: {channel}",
            "detail": "Canal inválido especificado",
            "latency_ms": 0
        }

