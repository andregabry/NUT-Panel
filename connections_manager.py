import os
import json
import time
import uuid
import secrets
import logging
import threading
import requests
import socket
from typing import Dict, Any, List, Optional
try:
    import paramiko
except ImportError:
    paramiko = None

logger = logging.getLogger(__name__)

CONNECTIONS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "connections_data.json")

class ConnectionsManager:
    def __init__(self, data_file: str = CONNECTIONS_FILE):
        self.data_file = data_file
        self.lock = threading.Lock()
        self._load_data()

    def _get_default_data(self) -> Dict[str, Any]:
        default_token_id = str(uuid.uuid4())
        default_token_key = f"eng_live_{secrets.token_hex(16)}"
        
        return {
            "nut_server": {
                "host": "10.255.255.28",
                "port": 3493,
                "ups_name": "ups",
                "username": "enging",
                "password": "enging!pt",
                "poll_interval": 2.0,
                "timeout": 5.0,
                "status": "online",
                "last_checked": time.strftime("%Y-%m-%d %H:%M:%S")
            },
            "proxmox_servers": [
                {
                    "id": str(uuid.uuid4()),
                    "name": "Cluster Proxmox PVE01",
                    "host": "10.255.255.10",
                    "port": 8006,
                    "node_name": "pve01",
                    "auth_type": "token", # "token" or "password"
                    "realm": "pve", # "pve" or "pam"
                    "token_id": "root@pam!nut_automation",
                    "token_secret": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
                    "username": "root@pam",
                    "password": "",
                    "verify_ssl": False,
                    "enabled": True,
                    "status": "idle",
                    "last_test": None
                }
            ],
            "vmware_servers": [
                {
                    "id": str(uuid.uuid4()),
                    "name": "Host VMware ESXi 01",
                    "host": "10.255.255.20",
                    "port": 443,
                    "type": "esxi", # "esxi" or "vcenter"
                    "auth_type": "rest_api", # "rest_api" or "ssh"
                    "username": "root",
                    "password": "",
                    "verify_ssl": False,
                    "enabled": True,
                    "status": "idle",
                    "last_test": None
                }
            ],
            "messaging_gateways": {
                "whatsapp": {
                    "provider": "evolution", # "evolution", "zapi", "custom_webhook"
                    "api_url": "https://api.whatsapp.example.com/message/sendText",
                    "api_token": "",
                    "instance_id": "enging-ups",
                    "enabled": False,
                    "last_test": None
                },
                "sms": {
                    "provider": "http_api",
                    "api_url": "https://api.sms-gateway.example.com/send",
                    "api_token": "",
                    "sender_id": "ENGING_UPS",
                    "enabled": False,
                    "last_test": None
                },
                "smtp": {
                    "host": "smtp.gmail.com",
                    "port": 587,
                    "use_tls": True,
                    "username": "alerts@enging.pt",
                    "password": "",
                    "from_email": "alerts@enging.pt",
                    "from_name": "Enging UPS System",
                    "enabled": False,
                    "last_test": None
                },
                "webhooks": [
                    {
                        "id": str(uuid.uuid4()),
                        "name": "Zabbix / SIEM Webhook",
                        "url": "https://zabbix.enging.pt/api/webhook/ups",
                        "secret_token": "secret_token_123",
                        "event_types": ["power_loss", "battery_low", "shutdown_triggered"],
                        "enabled": True,
                        "last_test": None
                    }
                ]
            },
            "api_tokens": [
                {
                    "id": default_token_id,
                    "name": "Integração Grafana / Zabbix (Read-Only)",
                    "token": default_token_key,
                    "prefix": default_token_key[:12] + "...",
                    "permissions": "read_only", # "read_only", "read_write", "full_admin"
                    "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                    "last_used": None,
                    "enabled": True
                }
            ]
        }

    def _load_data(self):
        with self.lock:
            if not os.path.exists(self.data_file):
                self.data = self._get_default_data()
                self._save_data_no_lock()
                return

            try:
                with open(self.data_file, "r", encoding="utf-8") as f:
                    self.data = json.load(f)
            except Exception as e:
                logger.error(f"Erro ao carregar ficheiro de conexões ({self.data_file}): {e}")
                self.data = self._get_default_data()
                self._save_data_no_lock()

    def _save_data_no_lock(self):
        try:
            temp_file = self.data_file + ".tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
            os.replace(temp_file, self.data_file)
        except Exception as e:
            logger.error(f"Erro ao salvar conexões: {e}")

    def get_all(self) -> Dict[str, Any]:
        with self.lock:
            # Mask sensitive secrets for UI display
            safe_data = json.loads(json.dumps(self.data))
            # Mask tokens/passwords partially
            if "proxmox_servers" in safe_data:
                for s in safe_data["proxmox_servers"]:
                    if s.get("password"):
                        s["has_password"] = True
                        s["password"] = "••••••••"
                    if s.get("private_key"):
                        s["has_private_key"] = True
                        s["private_key"] = "••••••••"
            if "vmware_servers" in safe_data:
                for s in safe_data["vmware_servers"]:
                    if s.get("password"):
                        s["has_password"] = True
                        s["password"] = "••••••••"
            return safe_data

    # --- NUT SERVER CONFIG ---
    def update_nut_server(self, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            current = self.data.setdefault("nut_server", {})
            current["host"] = payload.get("host", current.get("host", "127.0.0.1"))
            current["port"] = int(payload.get("port", current.get("port", 3493)))
            current["ups_name"] = payload.get("ups_name", current.get("ups_name", "ups"))
            current["username"] = payload.get("username", current.get("username", ""))
            if payload.get("password"):
                current["password"] = payload.get("password")
            current["poll_interval"] = float(payload.get("poll_interval", current.get("poll_interval", 2.0)))
            current["timeout"] = float(payload.get("timeout", current.get("timeout", 5.0)))
            self._save_data_no_lock()
            return current

    def test_nut_connection(self, host: str, port: int, ups_name: str, username: str = "", password: str = "") -> Dict[str, Any]:
        start = time.time()
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            sock.settimeout(3.0)
            sock.connect((host, int(port)))
            
            # Send VER command
            sock.sendall(b"VER\n")
            res_ver = sock.recv(1024).decode('utf-8', errors='ignore').strip()
            
            # Send LIST UPS command
            sock.sendall(b"LIST UPS\n")
            res_ups = sock.recv(2048).decode('utf-8', errors='ignore').strip()
            sock.close()
            
            latency = round((time.time() - start) * 1000, 1)
            ups_found = ups_name in res_ups if res_ups else False

            with self.lock:
                if "nut_server" in self.data:
                    self.data["nut_server"]["status"] = "online"
                    self.data["nut_server"]["last_checked"] = time.strftime("%Y-%m-%d %H:%M:%S")
                    self._save_data_no_lock()

            return {
                "success": True,
                "latency_ms": latency,
                "version": res_ver,
                "ups_list": res_ups,
                "ups_found": ups_found,
                "message": f"Conexão ao NUT Server bem sucedida ({latency}ms)! Versão: {res_ver}"
            }
        except Exception as e:
            latency = round((time.time() - start) * 1000, 1)
            with self.lock:
                if "nut_server" in self.data:
                    self.data["nut_server"]["status"] = "offline"
                    self.data["nut_server"]["last_checked"] = time.strftime("%Y-%m-%d %H:%M:%S")
                    self._save_data_no_lock()
            return {
                "success": False,
                "latency_ms": latency,
                "error": str(e),
                "message": f"Falha na conexão ao servidor NUT ({host}:{port}): {str(e)}"
            }

    # --- PROXMOX SERVERS (SSH) ---
    def save_proxmox_server(self, server_data: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            servers = self.data.setdefault("proxmox_servers", [])
            s_id = server_data.get("id")
            
            existing = None
            if s_id:
                for s in servers:
                    if s.get("id") == s_id:
                        existing = s
                        break
            
            if not existing:
                s_id = str(uuid.uuid4())
                existing = {"id": s_id}
                servers.append(existing)

            existing["name"] = server_data.get("name", "Nó Proxmox VE")
            existing["host"] = server_data.get("host", "127.0.0.1")
            existing["port"] = int(server_data.get("port", 22))
            existing["node_name"] = server_data.get("node_name", "pve")
            existing["auth_type"] = server_data.get("auth_type", "password") # "password" or "key"
            existing["username"] = server_data.get("username", "root")
            if server_data.get("password") and server_data.get("password") != "••••••••":
                existing["password"] = server_data.get("password")
            if "private_key" in server_data:
                if server_data.get("private_key") and not server_data.get("private_key").startswith("••••"):
                    existing["private_key"] = server_data.get("private_key")
            existing["sudo"] = bool(server_data.get("sudo", False))
            existing["custom_shutdown_cmd"] = server_data.get("custom_shutdown_cmd", "shutdown -h now")
            existing["enabled"] = bool(server_data.get("enabled", True))
            
            self._save_data_no_lock()
            return existing

    def delete_proxmox_server(self, server_id: str) -> bool:
        with self.lock:
            servers = self.data.setdefault("proxmox_servers", [])
            initial_len = len(servers)
            self.data["proxmox_servers"] = [s for s in servers if s.get("id") != server_id]
            changed = len(self.data["proxmox_servers"]) < initial_len
            if changed:
                self._save_data_no_lock()
            return changed

    def test_proxmox_server(self, server_id: str) -> Dict[str, Any]:
        server = None
        with self.lock:
            for s in self.data.get("proxmox_servers", []):
                if s.get("id") == server_id:
                    server = dict(s)
                    break
        
        if not server:
            return {"success": False, "message": "Servidor Proxmox não encontrado"}

        host = server.get("host")
        port = int(server.get("port", 22))
        username = server.get("username", "root")
        password = server.get("password", "")
        auth_type = server.get("auth_type", "password")
        private_key_str = server.get("private_key", "")

        if not paramiko:
            return {"success": False, "message": "Módulo SSH (paramiko) não disponível no servidor"}

        start = time.time()
        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            connect_kwargs = {
                "hostname": host,
                "port": port,
                "username": username,
                "timeout": 6
            }

            if auth_type == "key" and private_key_str:
                import io
                key_file = io.StringIO(private_key_str)
                try:
                    pkey = paramiko.RSAKey.from_private_key(key_file)
                except Exception:
                    key_file.seek(0)
                    pkey = paramiko.Ed25519Key.from_private_key(key_file)
                connect_kwargs["pkey"] = pkey
            elif password:
                connect_kwargs["password"] = password

            ssh.connect(**connect_kwargs)

            # 1. Obter versão do Proxmox VE
            stdin, stdout, stderr = ssh.exec_command("pveversion 2>/dev/null || uname -sr")
            ver_output = stdout.read().decode('utf-8', errors='ignore').strip()

            # 2. Obter hostname e contagem de VMs/Containers
            stdin, stdout, stderr = ssh.exec_command("hostname; qm list 2>/dev/null | grep -v 'VMID' | wc -l; pct list 2>/dev/null | grep -v 'VMID' | wc -l")
            info_lines = stdout.read().decode('utf-8', errors='ignore').strip().splitlines()
            
            pve_hostname = info_lines[0] if len(info_lines) > 0 else host
            qemu_count = int(info_lines[1]) if len(info_lines) > 1 and info_lines[1].strip().isdigit() else 0
            lxc_count = int(info_lines[2]) if len(info_lines) > 2 and info_lines[2].strip().isdigit() else 0

            ssh.close()
            latency = round((time.time() - start) * 1000, 1)

            with self.lock:
                for s in self.data.get("proxmox_servers", []):
                    if s.get("id") == server_id:
                        s["status"] = "online"
                        s["last_test"] = f"OK (SSH - {ver_output.split()[0] if ver_output else 'Proxmox'} - {latency}ms)"
                self._save_data_no_lock()

            return {
                "success": True,
                "latency_ms": latency,
                "version": ver_output or "Proxmox VE (Linux Kernel)",
                "hostname": pve_hostname,
                "vm_count": qemu_count,
                "lxc_count": lxc_count,
                "message": f"Conexão SSH ao Proxmox bem-sucedida ({latency}ms)!\nHost: {pve_hostname} | Versão: {ver_output} | {qemu_count} VMs / {lxc_count} LXC"
            }

        except Exception as e:
            latency = round((time.time() - start) * 1000, 1)
            with self.lock:
                for s in self.data.get("proxmox_servers", []):
                    if s.get("id") == server_id:
                        s["status"] = "error"
                        s["last_test"] = f"Erro SSH: {str(e)[:40]}"
                self._save_data_no_lock()
            return {
                "success": False,
                "latency_ms": latency,
                "error": str(e),
                "message": f"Falha na conexão SSH ao Proxmox ({host}:{port}): {str(e)}"
            }

    # --- VMWARE SERVERS ---
    def save_vmware_server(self, server_data: Dict[str, Any]) -> Dict[str, Any]:
        with self.lock:
            servers = self.data.setdefault("vmware_servers", [])
            s_id = server_data.get("id")
            
            existing = None
            if s_id:
                for s in servers:
                    if s.get("id") == s_id:
                        existing = s
                        break
            
            if not existing:
                s_id = str(uuid.uuid4())
                existing = {"id": s_id}
                servers.append(existing)

            existing["name"] = server_data.get("name", "Host VMware ESXi")
            existing["host"] = server_data.get("host", "127.0.0.1")
            existing["port"] = int(server_data.get("port", 443))
            existing["type"] = server_data.get("type", "esxi")
            existing["auth_type"] = server_data.get("auth_type", "rest_api")
            existing["username"] = server_data.get("username", "root")
            if server_data.get("password") and server_data.get("password") != "••••••••":
                existing["password"] = server_data.get("password")
            existing["verify_ssl"] = bool(server_data.get("verify_ssl", False))
            existing["enabled"] = bool(server_data.get("enabled", True))
            
            self._save_data_no_lock()
            return existing

    def delete_vmware_server(self, server_id: str) -> bool:
        with self.lock:
            servers = self.data.setdefault("vmware_servers", [])
            initial_len = len(servers)
            self.data["vmware_servers"] = [s for s in servers if s.get("id") != server_id]
            changed = len(self.data["vmware_servers"]) < initial_len
            if changed:
                self._save_data_no_lock()
            return changed

    def test_vmware_server(self, server_id: str) -> Dict[str, Any]:
        server = None
        with self.lock:
            for s in self.data.get("vmware_servers", []):
                if s.get("id") == server_id:
                    server = dict(s)
                    break
        
        if not server:
            return {"success": False, "message": "Servidor VMware não encontrado"}

        host = server.get("host")
        port = server.get("port", 443)
        auth_type = server.get("auth_type", "rest_api")
        start = time.time()

        if auth_type == "ssh" and paramiko:
            try:
                ssh = paramiko.SSHClient()
                ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())
                ssh.connect(host, port=22, username=server.get("username"), password=server.get("password"), timeout=5)
                _, stdout, _ = ssh.exec_command("esxcli system version get || uname -a")
                res = stdout.read().decode('utf-8', errors='ignore').strip()
                ssh.close()
                latency = round((time.time() - start) * 1000, 1)

                with self.lock:
                    for s in self.data.get("vmware_servers", []):
                        if s.get("id") == server_id:
                            s["status"] = "online"
                            s["last_test"] = f"OK (SSH - {latency}ms)"
                    self._save_data_no_lock()

                return {
                    "success": True,
                    "latency_ms": latency,
                    "output": res,
                    "message": f"Conexão SSH ao ESXi bem sucedida ({latency}ms)!\n{res[:100]}"
                }
            except Exception as e:
                latency = round((time.time() - start) * 1000, 1)
                return {"success": False, "error": str(e), "message": f"Erro SSH ao ESXi ({host}): {str(e)}"}

        # HTTP/REST ping
        try:
            url = f"https://{host}:{port}/api"
            res = requests.get(url, verify=server.get("verify_ssl", False), timeout=5)
            latency = round((time.time() - start) * 1000, 1)
            
            with self.lock:
                for s in self.data.get("vmware_servers", []):
                    if s.get("id") == server_id:
                        s["status"] = "online"
                        s["last_test"] = f"OK (HTTPS - {latency}ms)"
                self._save_data_no_lock()

            return {
                "success": True,
                "latency_ms": latency,
                "message": f"Conexão HTTPS ao VMware ({host}:{port}) respondeu com status {res.status_code} ({latency}ms)."
            }
        except Exception as e:
            latency = round((time.time() - start) * 1000, 1)
            return {"success": False, "error": str(e), "message": f"Erro ao conectar ao VMware ({host}:{port}): {str(e)}"}

    # --- API TOKENS MANAGEMENT ---
    def generate_api_token(self, name: str, permissions: str = "read_only") -> Dict[str, Any]:
        with self.lock:
            tokens = self.data.setdefault("api_tokens", [])
            token_id = str(uuid.uuid4())
            secret = f"eng_live_{secrets.token_hex(20)}"
            
            entry = {
                "id": token_id,
                "name": name or "Nova Chave de API",
                "token": secret,
                "prefix": secret[:14] + "...",
                "permissions": permissions, # "read_only", "read_write", "full_admin"
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                "last_used": None,
                "enabled": True
            }
            tokens.append(entry)
            self._save_data_no_lock()
            return entry

    def delete_api_token(self, token_id: str) -> bool:
        with self.lock:
            tokens = self.data.setdefault("api_tokens", [])
            initial_len = len(tokens)
            self.data["api_tokens"] = [t for t in tokens if t.get("id") != token_id]
            changed = len(self.data["api_tokens"]) < initial_len
            if changed:
                self._save_data_no_lock()
            return changed

    def validate_api_token(self, raw_token: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            for t in self.data.get("api_tokens", []):
                if t.get("enabled") and t.get("token") == raw_token:
                    t["last_used"] = time.strftime("%Y-%m-%d %H:%M:%S")
                    self._save_data_no_lock()
                    return dict(t)
        return None
