import os
import json
import time
import uuid
import logging
import threading
import subprocess
import socket
import re
from typing import Dict, Any, List, Optional
import requests
try:
    import paramiko
except ImportError:
    paramiko = None

from db import db

logger = logging.getLogger(__name__)

PLANS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shutdown_plans.json")

class ShutdownManager:
    def __init__(self, plans_file: str = PLANS_FILE):
        self.plans_file = plans_file
        self.lock = threading.Lock()
        self.active_threads: Dict[str, threading.Thread] = {}
        self.connections_manager = None
        self.alert_manager = None
        self.latest_nut_data = {}
        self.online_stable_since = None
        self._load_data()

    def _get_default_data(self) -> Dict[str, Any]:
        plan1_id = str(uuid.uuid4())
        plan2_id = str(uuid.uuid4())
        plan3_id = str(uuid.uuid4())
        return {
            "plans": [
                {
                    "id": plan1_id,
                    "name": "Estágio 1 - VMs Não-Críticas / Dev (60%)",
                    "description": "Desliga máquinas virtuais de desenvolvimento e testes no Proxmox quando a bateria atingir 60%",
                    "enabled": True,
                    "trigger_battery_pct": 60.0,
                    "require_on_battery": True,
                    "grace_period_sec": 10,
                    "state": {
                        "status": "idle", # idle, countdown, running, completed, cancelled
                        "countdown_remaining": 0,
                        "triggered_at": None,
                        "current_server": None,
                        "results": []
                    },
                    "servers": [
                        {
                            "id": str(uuid.uuid4()),
                            "name": "Proxmox - VMs Dev (qm shutdown)",
                            "host": "10.255.255.10",
                            "port": 22,
                            "method": "ssh",
                            "username": "root",
                            "password": "",
                            "sudo": False,
                            "custom_command": "for vmid in 101 102 103 104 105 106 107 108; do qm shutdown $vmid & done; wait",
                            "delay_sec": 0,
                            "enabled": True,
                            "last_test": None
                        }
                    ]
                },
                {
                    "id": plan2_id,
                    "name": "Estágio 2 - Servidores Críticos & Hosts (15%)",
                    "description": "Desliga nós de virtualização VMware, Proxmox e Storages quando a bateria atingir 15%",
                    "enabled": True,
                    "trigger_battery_pct": 15.0,
                    "require_on_battery": True,
                    "grace_period_sec": 15,
                    "state": {
                        "status": "idle",
                        "countdown_remaining": 0,
                        "triggered_at": None,
                        "current_server": None,
                        "results": []
                    },
                    "servers": [
                        {
                            "id": str(uuid.uuid4()),
                            "name": "Host Proxmox Cluster Node 1",
                            "host": "10.255.255.10",
                            "port": 22,
                            "method": "ssh",
                            "username": "root",
                            "password": "",
                            "sudo": False,
                            "custom_command": "shutdown -h now",
                            "delay_sec": 0,
                            "enabled": True,
                            "last_test": None
                        },
                        {
                            "id": str(uuid.uuid4()),
                            "name": "Host VMware ESXi Node 2",
                            "host": "10.255.255.20",
                            "port": 22,
                            "method": "ssh",
                            "username": "root",
                            "password": "",
                            "sudo": False,
                            "custom_command": "esxcli system shutdown poweroff -d 10 -r 'UPS Low Battery'",
                            "delay_sec": 30,
                            "enabled": True,
                            "last_test": None
                        }
                    ]
                },
                {
                    "id": plan3_id,
                    "name": "Estágio 3 - Servidor Local da UPS (5%)",
                    "description": "Desligamento final do próprio servidor NUT quando a bateria atingir 5%",
                    "enabled": True,
                    "trigger_battery_pct": 5.0,
                    "require_on_battery": True,
                    "grace_period_sec": 5,
                    "state": {
                        "status": "idle",
                        "countdown_remaining": 0,
                        "triggered_at": None,
                        "current_server": None,
                        "results": []
                    },
                    "servers": [
                        {
                            "id": str(uuid.uuid4()),
                            "name": "Servidor Local NUT (10.255.255.28)",
                            "host": "127.0.0.1",
                            "port": 22,
                            "method": "local_command",
                            "username": "root",
                            "password": "",
                            "sudo": True,
                            "custom_command": "shutdown -h now",
                            "delay_sec": 0,
                            "enabled": True,
                            "last_test": None
                        }
                    ]
                }
            ],
            "logs": []
        }

    def _load_data(self) -> None:
        with self.lock:
            try:
                db_plans = db.get_plans()
                if db_plans:
                    db_logs = db.get_shutdown_logs(limit=150)
                    self.data = {
                        "plans": db_plans,
                        "logs": db_logs
                    }
                    logger.info(f"Planos de desligamento carregados do SQLite: {len(db_plans)} planos.")
                    return
            except Exception as e:
                logger.warning(f"Erro ao ler planos do SQLite: {e}")

            if os.path.exists(self.plans_file):
                try:
                    with open(self.plans_file, "r", encoding="utf-8") as f:
                        self.data = json.load(f)
                    for p in self.data.get("plans", []):
                        p.setdefault("state", {
                            "status": "idle",
                            "countdown_remaining": 0,
                            "triggered_at": None,
                            "current_server": None,
                            "results": []
                        })
                    logger.info("Planos carregados de shutdown_plans.json. A sincronizar com SQLite...")
                    self._save_data_unlocked()
                    return
                except Exception as e:
                    logger.error(f"Erro ao ler {self.plans_file}: {e}")
            self.data = self._get_default_data()
            self._save_data_unlocked()

    def _save_data_unlocked(self) -> None:
        try:
            for p in self.data.get("plans", []):
                db.save_plan(p)
            # Salva também ficheiro JSON para redundância
            with open(self.plans_file, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Erro ao gravar planos: {e}")

    def get_all_plans(self) -> Dict[str, Any]:
        with self.lock:
            return self.data

    def get_plan_by_id(self, plan_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            return next((p for p in self.data.get("plans", []) if p["id"] == plan_id), None)

    def create_or_update_plan(self, plan_payload: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            plan_id = plan_payload.get("id")
            if not plan_id:
                plan_id = str(uuid.uuid4())
                plan_payload["id"] = plan_id
                plan_payload["state"] = {
                    "status": "idle",
                    "countdown_remaining": 0,
                    "triggered_at": None,
                    "current_server": None,
                    "results": []
                }
                plan_payload.setdefault("servers", [])
                self.data.setdefault("plans", []).append(plan_payload)
                self.add_log_unlocked("info", f"Novo plano criado: '{plan_payload.get('name')}' (Trigger: {plan_payload.get('trigger_battery_pct')}%)", server_name="Gestão de Planos")
            else:
                updated = False
                for i, p in enumerate(self.data.setdefault("plans", [])):
                    if p["id"] == plan_id:
                        # Preserva servidores e estado existente se não passados
                        servers = plan_payload.get("servers", p.get("servers", []))
                        state = p.get("state", {
                            "status": "idle",
                            "countdown_remaining": 0,
                            "triggered_at": None,
                            "current_server": None,
                            "results": []
                        })
                        self.data["plans"][i] = {
                            **plan_payload,
                            "servers": servers,
                            "state": state
                        }
                        updated = True
                        self.add_log_unlocked("info", f"Plano atualizado: '{plan_payload.get('name')}' (Trigger: {plan_payload.get('trigger_battery_pct')}%)", server_name="Gestão de Planos")
                        break
                if not updated:
                    plan_payload.setdefault("servers", [])
                    plan_payload["state"] = {
                        "status": "idle",
                        "countdown_remaining": 0,
                        "triggered_at": None,
                        "current_server": None,
                        "results": []
                    }
                    self.data["plans"].append(plan_payload)

            self._save_data_unlocked()
            return plan_payload

    def delete_plan(self, plan_id: str) -> bool:
        with self.lock:
            try:
                db.delete_plan(plan_id)
            except Exception as e:
                logger.warning(f"Erro ao remover plano do SQLite: {e}")
            orig_len = len(self.data.get("plans", []))
            target = next((p for p in self.data.get("plans", []) if p["id"] == plan_id), None)
            name = target.get("name") if target else plan_id
            self.data["plans"] = [p for p in self.data.get("plans", []) if p["id"] != plan_id]
            if len(self.data["plans"]) != orig_len:
                self.add_log_unlocked("warning", f"Plano removido: '{name}'", server_name="Gestão de Planos")
                self._save_data_unlocked()
                return True
            return False

    def add_or_update_server(self, plan_id: str, server_payload: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            plan = next((p for p in self.data.get("plans", []) if p["id"] == plan_id), None)
            if not plan:
                raise ValueError("Plano não encontrado")
            
            server_id = server_payload.get("id")
            conn_id = server_payload.get("connection_id")
            new_guests = server_payload.get("selected_guests", [])

            # Validar que nenhuma VM/CT já está atribuída a outro plano ou alvo
            if conn_id and new_guests:
                for other_plan in self.data.get("plans", []):
                    for other_srv in other_plan.get("servers", []):
                        # Ignora o próprio alvo que está sendo editado
                        if other_plan["id"] == plan_id and other_srv.get("id") == server_id:
                            continue
                        if other_srv.get("connection_id") == conn_id:
                            for og in other_srv.get("selected_guests", []):
                                for ng in new_guests:
                                    if str(ng.get("id")) == str(og.get("id")) and ng.get("type", "qemu") == og.get("type", "qemu"):
                                        target_name = ng.get("name") or ng.get("id")
                                        raise ValueError(
                                            f"A VM/CT '{target_name}' (ID: {ng.get('id')}) já foi selecionada como alvo no plano '{other_plan.get('name')}'."
                                        )

            if not server_id:
                server_id = str(uuid.uuid4())
                server_payload["id"] = server_id
                plan.setdefault("servers", []).append(server_payload)
            else:
                updated = False
                for i, s in enumerate(plan.setdefault("servers", [])):
                    if s["id"] == server_id:
                        plan["servers"][i] = server_payload
                        updated = True
                        break
                if not updated:
                    plan["servers"].append(server_payload)

            self._save_data_unlocked()
            return server_payload

    def delete_server(self, plan_id: str, server_id: str) -> bool:
        with self.lock:
            try:
                db.delete_plan_server(plan_id, server_id)
            except Exception as e:
                logger.warning(f"Erro ao remover alvo do plano no SQLite: {e}")
            plan = next((p for p in self.data.get("plans", []) if p["id"] == plan_id), None)
            if not plan:
                return False
            orig_len = len(plan.get("servers", []))
            plan["servers"] = [s for s in plan.get("servers", []) if s["id"] != server_id]
            if len(plan["servers"]) != orig_len:
                self._save_data_unlocked()
                return True
            return False

    def add_log_unlocked(self, level: str, message: str, server_name: str = "Sistema", details: Any = None) -> None:
        try:
            db.add_shutdown_log(level, message, server_name)
        except Exception as e:
            logger.warning(f"Erro ao adicionar log no SQLite: {e}")
        log_entry = {
            "id": str(uuid.uuid4()),
            "timestamp": time.time(),
            "formatted_time": time.strftime("%Y-%m-%d %H:%M:%S"),
            "level": level,
            "server": server_name,
            "message": message,
            "details": details
        }
        logs = self.data.setdefault("logs", [])
        logs.insert(0, log_entry)
        self.data["logs"] = logs[:300]

    def add_log(self, level: str, message: str, server_name: str = "Sistema", details: Any = None) -> None:
        with self.lock:
            self.add_log_unlocked(level, message, server_name, details)
            self._save_data_unlocked()

    def _resolve_server_credentials(self, server: Dict[str, Any]) -> Dict[str, Any]:
        """Resolve credenciais herdadas do connections_manager se houver connection_id."""
        s = dict(server)
        conn_id = s.get("connection_id")
        conn_type = s.get("connection_type", "proxmox")
        if conn_id and getattr(self, "connections_manager", None):
            creds = self.connections_manager.get_server_credentials(conn_type, conn_id)
            if creds:
                if not s.get("host") or s.get("host") == "127.0.0.1":
                    s["host"] = creds.get("host", s.get("host"))
                if not s.get("port"):
                    s["port"] = creds.get("port", 22)
                if not s.get("username"):
                    s["username"] = creds.get("username", "root")
                if not s.get("password") or s.get("password") == "••••••••":
                    s["password"] = creds.get("password", "")
                if "private_key" in creds and not s.get("private_key"):
                    s["private_key"] = creds.get("private_key", "")
                if "sudo" in creds and "sudo" not in s:
                    s["sudo"] = creds.get("sudo", False)
                if not s.get("wol_mac"):
                    s["wol_mac"] = creds.get("mac_address", "")
                if not s.get("wol_broadcast"):
                    s["wol_broadcast"] = creds.get("wol_broadcast", "255.255.255.255")
                if not s.get("ipmi_host"):
                    s["ipmi_host"] = creds.get("ipmi_host", "")
                if not s.get("ipmi_user"):
                    s["ipmi_user"] = creds.get("ipmi_user", "admin")
                if not s.get("ipmi_pass"):
                    s["ipmi_pass"] = creds.get("ipmi_password", "")
        return s

    def test_connection(self, server: Dict[str, Any]) -> Dict[str, Any]:
        """Testa conexão ao servidor ou VM sem desligar."""
        server = self._resolve_server_credentials(server)
        method = server.get("method", "ssh")
        host = server.get("host", "").strip()
        port = int(server.get("port", 22))
        name = server.get("name", "Servidor")

        if method == "local_command":
            try:
                res = subprocess.run(["uname", "-a"], capture_output=True, text=True, timeout=5)
                out = res.stdout.strip()
                return {
                    "success": True,
                    "message": "Comando local verificado com sucesso!",
                    "output": out,
                    "timestamp": time.strftime("%H:%M:%S")
                }
            except Exception as e:
                return {
                    "success": False,
                    "message": f"Erro no comando local: {e}",
                    "timestamp": time.strftime("%H:%M:%S")
                }

        if method in ("ssh", "windows_ssh"):
            if not paramiko:
                return {"success": False, "message": "Paramiko não instalado"}
            if not host:
                return {"success": False, "message": "Host/IP não configurado"}

            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            try:
                username = server.get("username", "root")
                password = server.get("password") or None
                connect_kwargs = {"hostname": host, "port": port, "username": username, "timeout": 35}
                if server.get("private_key"):
                    import io
                    try:
                        connect_kwargs["pkey"] = paramiko.RSAKey.from_private_key(io.StringIO(server["private_key"]))
                    except Exception:
                        connect_kwargs["pkey"] = paramiko.Ed25519Key.from_private_key(io.StringIO(server["private_key"]))
                elif password:
                    connect_kwargs["password"] = password
                ssh.connect(**connect_kwargs)
                
                test_cmd = "hostname && uname -a" if method == "ssh" else "hostname"
                stdin, stdout, stderr = ssh.exec_command(test_cmd, timeout=15)
                output = stdout.read().decode('utf-8', errors='replace').strip()
                ssh.close()
                
                return {
                    "success": True, 
                    "message": f"Conexão SSH estabelecida com sucesso!", 
                    "output": output,
                    "timestamp": time.strftime("%H:%M:%S")
                }
            except Exception as e:
                return {
                    "success": False, 
                    "message": f"Falha na conexão SSH: {str(e)}", 
                    "timestamp": time.strftime("%H:%M:%S")
                }

        elif method == "webhook":
            url = server.get("webhook_url", "").strip()
            if not url:
                return {"success": False, "message": "URL de Webhook não configurada"}
            try:
                req_method = server.get("webhook_method", "POST").upper()
                resp = requests.request(req_method, url, timeout=5)
                return {
                    "success": resp.status_code < 400,
                    "message": f"Webhook respondeu com HTTP {resp.status_code}",
                    "output": resp.text[:200],
                    "timestamp": time.strftime("%H:%M:%S")
                }
            except Exception as e:
                return {
                    "success": False, 
                    "message": f"Falha ao chamar Webhook: {str(e)}", 
                    "timestamp": time.strftime("%H:%M:%S")
                }

        return {"success": False, "message": f"Método desconhecido: {method}"}

    def execute_shutdown_server(self, server: Dict[str, Any], plan_name: str = "", dry_run: bool = False) -> Dict[str, Any]:
        """Executa a ordem de desligamento para um servidor específico."""
        server = self._resolve_server_credentials(server)
        name = server.get("name", "Servidor")
        server = self._resolve_server_credentials(server)
        method = server.get("method", "ssh")
        host = server.get("host", "").strip()
        port = int(server.get("port", 22))

        if dry_run:
            msg = f"[DRY-RUN] Simulação de desligamento para '{name}' ({host}) concluída."
            self.add_log("info", msg, server_name=f"{plan_name} / {name}")
            return {"success": True, "message": msg, "server": name}

        if method == "local_command":
            cmd = server.get("custom_command", "shutdown -h now").strip()
            try:
                msg = f"Executando comando local no servidor NUT: '{cmd}'"
                self.add_log("warning", msg, server_name=f"{plan_name} / {name}")
                # Executa em subprocesso desacoplado para permitir que a resposta retorne
                subprocess.Popen(cmd, shell=True)
                return {"success": True, "message": msg, "server": name}
            except Exception as e:
                err_msg = f"Erro ao executar comando local '{cmd}': {e}"
                self.add_log("error", err_msg, server_name=f"{plan_name} / {name}")
                return {"success": False, "message": err_msg, "server": name}

        if method in ("ssh", "windows_ssh"):
            if not paramiko:
                err = "Paramiko não instalado"
                self.add_log("error", f"Falha ao desligar {name}: {err}", server_name=f"{plan_name} / {name}")
                return {"success": False, "message": err, "server": name}

            ssh = paramiko.SSHClient()
            ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            try:
                username = server.get("username", "root")
                password = server.get("password") or None
                connect_kwargs = {"hostname": host, "port": port, "username": username, "timeout": 35}
                if server.get("private_key"):
                    import io
                    try:
                        connect_kwargs["pkey"] = paramiko.RSAKey.from_private_key(io.StringIO(server["private_key"]))
                    except Exception:
                        connect_kwargs["pkey"] = paramiko.Ed25519Key.from_private_key(io.StringIO(server["private_key"]))
                elif password:
                    connect_kwargs["password"] = password
                ssh.connect(**connect_kwargs)
                
                cmd = server.get("custom_command", "").strip()
                if not cmd:
                    cmd = "shutdown /s /t 0 /f" if method == "windows_ssh" else "shutdown -h now"

                if server.get("sudo") and not cmd.startswith("sudo"):
                    cmd = f"sudo -S {cmd}"
                    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=8)
                    if password:
                        stdin.write(f"{password}\n")
                        stdin.flush()
                else:
                    stdin, stdout, stderr = ssh.exec_command(cmd, timeout=8)

                out = stdout.read().decode('utf-8', errors='replace').strip()
                ssh.close()

                msg = f"Comando enviado com sucesso para {name} ({host}): '{cmd}'"
                self.add_log("warning", msg, server_name=f"{plan_name} / {name}", details=out)
                return {"success": True, "message": msg, "output": out, "server": name}
            except Exception as e:
                err_msg = f"Erro ao desligar {name} ({host}): {str(e)}"
                self.add_log("error", err_msg, server_name=f"{plan_name} / {name}")
                return {"success": False, "message": err_msg, "server": name}

        elif method == "webhook":
            url = server.get("webhook_url", "").strip()
            req_method = server.get("webhook_method", "POST").upper()
            try:
                resp = requests.request(req_method, url, timeout=8)
                msg = f"Webhook de desligamento enviado para {name} (HTTP {resp.status_code})"
                self.add_log("warning", msg, server_name=f"{plan_name} / {name}", details=resp.text[:200])
                return {"success": resp.status_code < 400, "message": msg, "server": name}
            except Exception as e:
                err_msg = f"Erro ao acionar webhook para {name}: {str(e)}"
                self.add_log("error", err_msg, server_name=f"{plan_name} / {name}")
                return {"success": False, "message": err_msg, "server": name}

        return {"success": False, "message": "Método inválido", "server": name}

    def cancel_plan(self, plan_id: str) -> None:
        with self.lock:
            plan = next((p for p in self.data.get("plans", []) if p["id"] == plan_id), None)
            if plan and plan["state"]["status"] in ("countdown", "running"):
                plan["state"]["status"] = "cancelled"
                self.add_log_unlocked("info", f"Execução do plano '{plan.get('name')}' foi cancelada manualmente.", server_name=plan.get("name"))
                self._save_data_unlocked()
                if self.alert_manager:
                    try:
                        self.alert_manager.send_shutdown_plan_notification(
                            plan, "cancelled", nut_data=self.latest_nut_data
                        )
                    except Exception as e:
                        logger.error(f"Erro ao disparar alerta de cancelamento: {e}")

    def run_plan_async(self, plan_id: str, dry_run: bool = False) -> None:
        """Executa um plano específico de forma assíncrona respeitando carência e delays."""
        with self.lock:
            plan = next((p for p in self.data.get("plans", []) if p["id"] == plan_id), None)
            if not plan:
                return
            if plan["state"]["status"] in ("countdown", "running"):
                return
            
            plan["state"]["status"] = "countdown"
            plan["state"]["triggered_at"] = time.time()
            plan["state"]["results"] = []
            grace = plan.get("grace_period_sec", 10)
            plan_name = plan.get("name", "Plano")
            servers = [s for s in plan.get("servers", []) if s.get("enabled", True)]

        self.add_log("warning", f"Iniciando contagem de segurança ({grace}s) para o plano '{plan_name}'...", server_name=plan_name)

        if self.alert_manager:
            try:
                self.alert_manager.send_shutdown_plan_notification(
                    plan, "triggered", dry_run=dry_run, nut_data=self.latest_nut_data
                )
            except Exception as e:
                logger.error(f"Erro ao disparar alerta de início de plano: {e}")

        def worker():
            # Countdown
            for remaining in range(grace, 0, -1):
                with self.lock:
                    if plan["state"]["status"] == "cancelled":
                        return
                    plan["state"]["countdown_remaining"] = remaining
                time.sleep(1)

            with self.lock:
                if plan["state"]["status"] == "cancelled":
                    return
                plan["state"]["status"] = "running"
                plan["state"]["countdown_remaining"] = 0

            self.add_log("warning", f"Disparando desligamento de {len(servers)} alvos do plano '{plan_name}'.", server_name=plan_name)

            # Ordenar por delay
            sorted_servers = sorted(servers, key=lambda x: x.get("delay_sec", 0))

            for s in sorted_servers:
                with self.lock:
                    if plan["state"]["status"] == "cancelled":
                        return
                    plan["state"]["current_server"] = s.get("name")

                delay = s.get("delay_sec", 0)
                if delay > 0:
                    time.sleep(delay)

                res = self.execute_shutdown_server(s, plan_name=plan_name, dry_run=dry_run)
                with self.lock:
                    plan["state"]["results"].append(res)

            with self.lock:
                plan["state"]["status"] = "completed"
                plan["state"]["current_server"] = None
                if not dry_run:
                    plan["state"]["shutdown_executed"] = True
                self._save_data_unlocked()

            self.add_log("info", f"Plano '{plan_name}' concluído com sucesso.", server_name=plan_name)

            if self.alert_manager:
                try:
                    self.alert_manager.send_shutdown_plan_notification(
                        plan, "completed", results=plan["state"]["results"], dry_run=dry_run, nut_data=self.latest_nut_data
                    )
                except Exception as e:
                    logger.error(f"Erro ao disparar alerta de conclusão de plano: {e}")

        t = threading.Thread(target=worker, daemon=True)
        self.active_threads[plan_id] = t
        t.start()

    @staticmethod
    def send_wake_on_lan(mac_address: str, broadcast_ip: str = "255.255.255.255", port: int = 9) -> bool:
        """Envia um Pacote Mágico Wake-on-LAN (WoL) para acordar um servidor físico."""
        if not mac_address:
            return False
        clean_mac = re.sub(r'[^a-fA-F0-9]', '', mac_address)
        if len(clean_mac) != 12:
            raise ValueError(f"Endereço MAC inválido ({mac_address}). Deve conter 12 caracteres hexadecimais.")
        mac_bytes = bytes.fromhex(clean_mac)
        magic_packet = b'\xff' * 6 + mac_bytes * 16

        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
            targets = set([broadcast_ip, "255.255.255.255", "10.255.255.255", "192.168.5.255", "192.168.11.255"])
            for b_ip in targets:
                try:
                    sock.sendto(magic_packet, (b_ip, port))
                    sock.sendto(magic_packet, (b_ip, 7))
                except Exception:
                    pass
        return True

    @staticmethod
    def send_ipmi_power_on(host: str, user: str = "admin", password: str = "") -> bool:
        """Envia comando de inicialização IPMI Chassis Power On."""
        if not host:
            return False
        cmd = f"ipmitool -I lanplus -H {host} -U '{user}' -P '{password}' chassis power on"
        try:
            res = subprocess.run(cmd, shell=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=8)
            return res.returncode == 0
        except Exception:
            return False

    def _wait_for_host_online(self, host: str, port: int = 22, timeout_sec: int = 120) -> bool:
        """Sonda periodicamente um host via socket TCP até que ele esteja online e aceitando conexões."""
        start = time.time()
        while time.time() - start < timeout_sec:
            try:
                with socket.create_connection((host, port), timeout=2.0):
                    return True
            except (socket.timeout, ConnectionRefusedError, OSError):
                time.sleep(4)
        return False

    def execute_poweron_server(self, server: Dict[str, Any], plan_name: str = "", dry_run: bool = False) -> Dict[str, Any]:
        """Executa a rotina de religamento (Wake-on-LAN para o nó físico e/ou arranque das VMs/CTs)."""
        server = self._resolve_server_credentials(server)
        name = server.get("name", "Servidor")
        host = server.get("host", "").strip()
        port = int(server.get("port", 22))
        shutdown_host = server.get("shutdown_host", False)
        wol_mac = server.get("wol_mac", "").strip()
        wol_broadcast = server.get("wol_broadcast", "255.255.255.255").strip() or "255.255.255.255"
        ipmi_host = server.get("ipmi_host", "").strip()
        selected_guests = server.get("selected_guests", [])

        results = {
            "server": name,
            "host_awakened": False,
            "guests_started": [],
            "errors": []
        }

        # 1. Acordar o Servidor Físico (se estava marcado para desligar host ou tem MAC WoL)
        if shutdown_host or wol_mac:
            if dry_run:
                msg = f"[DRY-RUN] Simulação: Enviaria pacote Wake-on-LAN para MAC '{wol_mac}'" + (f" e IPMI para '{ipmi_host}'" if ipmi_host else "")
                self.add_log("info", msg, server_name=f"{plan_name} / {name}")
                results["host_awakened"] = True
            else:
                if wol_mac:
                    try:
                        self.send_wake_on_lan(wol_mac, broadcast_ip=wol_broadcast)
                        self.add_log("warning", f"Pacote Mágico Wake-on-LAN enviado para {name} (MAC: {wol_mac}, Broadcast: {wol_broadcast}).", server_name=f"{plan_name} / {name}")
                        results["host_awakened"] = True
                    except Exception as e:
                        err_msg = f"Falha ao enviar WoL para {name} ({wol_mac}): {e}"
                        self.add_log("error", err_msg, server_name=f"{plan_name} / {name}")
                        results["errors"].append(err_msg)

                if ipmi_host:
                    try:
                        ipmi_ok = self.send_ipmi_power_on(ipmi_host, server.get("ipmi_user", "admin"), server.get("ipmi_pass", ""))
                        if ipmi_ok:
                            self.add_log("warning", f"Comando IPMI Power On enviado para {name} ({ipmi_host}).", server_name=f"{plan_name} / {name}")
                            results["host_awakened"] = True
                    except Exception as e:
                        err_msg = f"Falha ao acionar IPMI em {name} ({ipmi_host}): {e}"
                        self.add_log("error", err_msg, server_name=f"{plan_name} / {name}")
                        results["errors"].append(err_msg)

                # Aguarda o boot do host físico (health-check via porta 22) se ele tiver sido acordado
                if host:
                    self.add_log("info", f"Aguardando host {name} ({host}) concluir o arranque do SO (espera até 120s)...", server_name=f"{plan_name} / {name}")
                    booted = self._wait_for_host_online(host, port, timeout_sec=120)
                    if booted:
                        self.add_log("info", f"Host {name} ({host}) respondeu na rede com sucesso!", server_name=f"{plan_name} / {name}")
                    else:
                        err_msg = f"Aviso: Host {name} ({host}) não respondeu via SSH dentro de 120 segundos."
                        self.add_log("error", err_msg, server_name=f"{plan_name} / {name}")
                        results["errors"].append(err_msg)

        # 2. Religar VMs e Containers
        if selected_guests:
            if dry_run:
                for g in selected_guests:
                    g_type = (g.get("type") or "qemu").upper()
                    g_name = g.get("name", g.get("id"))
                    msg = f"[DRY-RUN] Simulação: Enviaria comando de arranque para {g_type} [{g.get('id')}] '{g_name}'"
                    self.add_log("info", msg, server_name=f"{plan_name} / {name}")
                    results["guests_started"].append(f"{g_type}:{g.get('id')}")
            else:
                if not paramiko:
                    err = "Módulo paramiko não disponível para SSH"
                    self.add_log("error", err, server_name=f"{plan_name} / {name}")
                    results["errors"].append(err)
                    return {"success": False, "message": err, "results": results}

                ssh = paramiko.SSHClient()
                ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                try:
                    username = server.get("username", "root")
                    password = server.get("password") or None
                    connect_kwargs = {"hostname": host, "port": port, "username": username, "timeout": 15}
                    if server.get("private_key"):
                        import io
                        try:
                            connect_kwargs["pkey"] = paramiko.RSAKey.from_private_key(io.StringIO(server["private_key"]))
                        except Exception:
                            connect_kwargs["pkey"] = paramiko.Ed25519Key.from_private_key(io.StringIO(server["private_key"]))
                    elif password:
                        connect_kwargs["password"] = password

                    ssh.connect(**connect_kwargs)

                    for g in selected_guests:
                        gid = g.get("id")
                        gtype = g.get("type") or "qemu"
                        gname = g.get("name", gid)

                        if gtype == "lxc":
                            start_cmd = f"pct start {gid}"
                        elif gtype == "vmware_vm":
                            start_cmd = f"vim-cmd vmsvc/power.on {gid}"
                        else: # qemu
                            start_cmd = f"qm start {gid}"

                        try:
                            stdin, stdout, stderr = ssh.exec_command(start_cmd, timeout=12)
                            out = stdout.read().decode('utf-8', errors='ignore').strip()
                            self.add_log("info", f"Instância {gtype.upper()} [{gid}] '{gname}' iniciada com sucesso.", server_name=f"{plan_name} / {name}")
                            results["guests_started"].append(f"{gtype}:{gid}")
                        except Exception as ex_g:
                            err_g = f"Erro ao iniciar {gtype.upper()} [{gid}] em {name}: {ex_g}"
                            self.add_log("error", err_g, server_name=f"{plan_name} / {name}")
                            results["errors"].append(err_g)

                        # Pequeno intervalo entre starts para evitar pico de IOPS
                        time.sleep(3)

                    ssh.close()
                except Exception as e:
                    err_msg = f"Falha ao conectar via SSH a {name} ({host}) para religar VMs: {e}"
                    self.add_log("error", err_msg, server_name=f"{plan_name} / {name}")
                    results["errors"].append(err_msg)

        # 3. Comando customizado de religamento (se houver)
        custom_poweron = server.get("custom_poweron_cmd", "").strip()
        if custom_poweron:
            if dry_run:
                self.add_log("info", f"[DRY-RUN] Simulação: Executaria comando de religamento customizado: '{custom_poweron}'", server_name=f"{plan_name} / {name}")
            else:
                try:
                    ssh = paramiko.SSHClient()
                    ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                    ssh.connect(hostname=host, port=port, username=server.get("username", "root"), password=server.get("password"), timeout=10)
                    ssh.exec_command(custom_poweron, timeout=10)
                    ssh.close()
                    self.add_log("info", f"Comando customizado de religamento enviado para {name}: '{custom_poweron}'", server_name=f"{plan_name} / {name}")
                except Exception as e:
                    results["errors"].append(str(e))

        is_success = len(results["errors"]) == 0
        return {"success": is_success, "message": f"Religamento de {name} finalizado.", "results": results}

    def run_poweron_plan_async(self, plan_id: str, dry_run: bool = False) -> None:
        """Executa a rotina de religamento (Wake-on-LAN + Inicialização de VMs) de forma assíncrona."""
        with self.lock:
            plan = next((p for p in self.data.get("plans", []) if p["id"] == plan_id), None)
            if not plan:
                return

            if plan["state"].get("poweron_running"):
                return

            plan["state"]["poweron_running"] = True
            plan["state"]["poweron_status"] = "running"
            plan["state"]["poweron_started_at"] = time.time()
            plan["state"]["poweron_results"] = []
            plan_name = plan.get("name", "Plano")
            servers = [s for s in plan.get("servers", []) if s.get("enabled", True)]

        self.add_log("warning", f"⚡ Disparando religamento de {len(servers)} alvos do plano '{plan_name}' (Modo: {'Simulação' if dry_run else 'Real'}).", server_name=plan_name)

        if self.alert_manager:
            try:
                self.alert_manager.send_shutdown_plan_notification(
                    plan, "poweron_triggered", dry_run=dry_run, nut_data=self.latest_nut_data
                )
            except Exception as e:
                logger.error(f"Erro ao disparar alerta de início de religamento: {e}")

        def worker():
            results = []
            for s in servers:
                with self.lock:
                    if plan["state"].get("poweron_cancelled"):
                        break
                    plan["state"]["current_server"] = s.get("name")

                res = self.execute_poweron_server(s, plan_name=plan_name, dry_run=dry_run)
                results.append(res)
                with self.lock:
                    plan["state"]["poweron_results"].append(res)

            with self.lock:
                plan["state"]["poweron_running"] = False
                plan["state"]["poweron_status"] = "completed"
                plan["state"]["current_server"] = None
                if not dry_run:
                    plan["state"]["shutdown_executed"] = False
                    plan["state"]["status"] = "idle"
                self._save_data_unlocked()

            self.add_log("info", f"✅ Rotina de religamento do plano '{plan_name}' finalizada com sucesso.", server_name=plan_name)

            if self.alert_manager:
                try:
                    self.alert_manager.send_shutdown_plan_notification(
                        plan, "poweron_completed", results=results, dry_run=dry_run, nut_data=self.latest_nut_data
                    )
                except Exception as e:
                    logger.error(f"Erro ao disparar alerta de conclusão de religamento: {e}")

        t = threading.Thread(target=worker, daemon=True)
        self.active_threads[f"poweron_{plan_id}"] = t
        t.start()

    def check_nut_triggers(self, nut_data: Dict[str, Any]) -> None:
        """Verifica gatilhos de desligamento E rotinas automáticas de religamento com histerese."""
        if not nut_data or not nut_data.get("connected"):
            return

        self.latest_nut_data = nut_data
        status = nut_data.get("status", {})
        battery = nut_data.get("battery", {})

        is_on_battery = status.get("is_on_battery", False)
        raw_status = status.get("raw", "")
        if "OB" in raw_status or "LB" in raw_status:
            is_on_battery = True

        battery_pct = battery.get("charge_pct", 100.0)
        is_online = status.get("is_online", True) and not is_on_battery

        now = time.time()

        # 1. Gestão do Temporizador de Estabilidade da Rede Elétrica AC
        if is_online:
            if not getattr(self, "online_stable_since", None):
                self.online_stable_since = now
        else:
            self.online_stable_since = None

        stable_seconds = (now - self.online_stable_since) if self.online_stable_since else 0

        # 2. Verificação de Planos para Desligamento ou Religamento
        plans_to_shutdown = []
        plans_to_poweron = []

        with self.lock:
            for plan in self.data.get("plans", []):
                if not plan.get("enabled", True):
                    continue

                state = plan.get("state", {})
                current_status = state.get("status", "idle")

                # ========================================================
                # ROTINA A: AUTO-RELIGAMENTO (Quando a energia AC volta)
                # ========================================================
                auto_poweron = plan.get("auto_poweron_enabled", True)
                shutdown_was_run = state.get("shutdown_executed", False)
                poweron_running = state.get("poweron_running", False)

                if is_online and auto_poweron and shutdown_was_run and not poweron_running:
                    min_stable = plan.get("poweron_min_stable_sec", 120)
                    min_batt = plan.get("poweron_min_battery_pct", 35.0)

                    # Verifica se a rede já está estável pelo tempo configurado E a bateria já atingiu a carga mínima segura
                    if stable_seconds >= min_stable and battery_pct >= min_batt:
                        plans_to_poweron.append(plan["id"])
                    else:
                        state["poweron_waiting_reason"] = (
                            f"Aguardando rede estável ({int(stable_seconds)}s/{min_stable}s) "
                            f"ou recarga mínima ({battery_pct:.0f}%/{min_batt:.0f}%)"
                        )

                # ========================================================
                # ROTINA B: GATILHOS DE DESLIGAMENTO (Quando em bateria)
                # ========================================================
                if current_status in ("countdown", "running", "completed"):
                    continue

                trigger_pct = plan.get("trigger_battery_pct", 30.0)
                require_on_batt = plan.get("require_on_battery", True)

                condition_met = False
                if require_on_batt:
                    if is_on_battery and battery_pct <= trigger_pct:
                        condition_met = True
                else:
                    if battery_pct <= trigger_pct:
                        condition_met = True

                if condition_met:
                    plans_to_shutdown.append((plan["id"], plan["name"], trigger_pct))

        # Executa planos de desligamento
        for plan_id, plan_name, trigger_pct in plans_to_shutdown:
            logger.warning(f"🚨 TRIGGER ATIVADO PARA O PLANO '{plan_name}'! Bateria: {battery_pct}% ≤ {trigger_pct}% (Em Bateria: {is_on_battery})")
            self.run_plan_async(plan_id, dry_run=False)

        # Executa planos de religamento
        for plan_id in plans_to_poweron:
            with self.lock:
                plan = next((p for p in self.data.get("plans", []) if p["id"] == plan_id), None)
                pname = plan.get("name") if plan else plan_id
            logger.info(f"⚡ DISPARANDO AUTO-RELIGAMENTO PARA O PLANO '{pname}'! (Bateria: {battery_pct}%, Rede estável por {int(stable_seconds)}s)")
            self.run_poweron_plan_async(plan_id, dry_run=False)
