import os
import json
import time
import uuid
import logging
import threading
import subprocess
from typing import Dict, Any, List, Optional
import requests
try:
    import paramiko
except ImportError:
    paramiko = None

logger = logging.getLogger(__name__)

PLANS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "shutdown_plans.json")

class ShutdownManager:
    def __init__(self, plans_file: str = PLANS_FILE):
        self.plans_file = plans_file
        self.lock = threading.Lock()
        self.active_threads: Dict[str, threading.Thread] = {}
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
            if os.path.exists(self.plans_file):
                try:
                    with open(self.plans_file, "r", encoding="utf-8") as f:
                        self.data = json.load(f)
                        # Garante estado para todos os planos
                        for p in self.data.get("plans", []):
                            p.setdefault("state", {
                                "status": "idle",
                                "countdown_remaining": 0,
                                "triggered_at": None,
                                "current_server": None,
                                "results": []
                            })
                        return
                except Exception as e:
                    logger.error(f"Erro ao ler {self.plans_file}: {e}")
            self.data = self._get_default_data()
            self._save_data_unlocked()

    def _save_data_unlocked(self) -> None:
        try:
            # Salva apenas dados essenciais, evitando salvar threads
            with open(self.plans_file, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Erro ao gravar {self.plans_file}: {e}")

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

    def test_connection(self, server: Dict[str, Any]) -> Dict[str, Any]:
        """Testa conexão ao servidor ou VM sem desligar."""
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
                ssh.connect(host, port=port, username=username, password=password, timeout=6)
                
                test_cmd = "hostname && uname -a" if method == "ssh" else "hostname"
                stdin, stdout, stderr = ssh.exec_command(test_cmd, timeout=5)
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
        name = server.get("name", "Servidor")
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
                ssh.connect(host, port=port, username=username, password=password, timeout=8)
                
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
                self._save_data_unlocked()

            self.add_log("info", f"Plano '{plan_name}' concluído com sucesso.", server_name=plan_name)

        t = threading.Thread(target=worker, daemon=True)
        self.active_threads[plan_id] = t
        t.start()

    def check_nut_triggers(self, nut_data: Dict[str, Any]) -> None:
        """Verifica os gatilhos de bateria individualmente para cada plano configurado."""
        status = nut_data.get("status", {})
        battery = nut_data.get("battery", {})

        is_on_battery = status.get("is_on_battery", False)
        raw_status = status.get("raw", "")
        if "OB" in raw_status or "LB" in raw_status:
            is_on_battery = True

        battery_pct = battery.get("charge_pct", 100.0)
        is_online = status.get("is_online", True)

        with self.lock:
            plans_to_run = []
            for plan in self.data.get("plans", []):
                if not plan.get("enabled", True):
                    continue

                state = plan.get("state", {})
                current_status = state.get("status", "idle")

                # Se a energia voltou e o plano estava completed ou cancelled, reseta para idle
                if is_online and current_status in ("completed", "cancelled"):
                    state["status"] = "idle"
                    state["results"] = []
                    continue

                # Se já está em contagem, execução ou já completou neste ciclo, pula
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
                    plans_to_run.append((plan["id"], plan["name"], trigger_pct))

        for plan_id, plan_name, trigger_pct in plans_to_run:
            logger.warning(f"🚨 TRIGGER ATIVADO PARA O PLANO '{plan_name}'! Bateria: {battery_pct}% ≤ {trigger_pct}% (Em Bateria: {is_on_battery})")
            self.run_plan_async(plan_id, dry_run=False)
