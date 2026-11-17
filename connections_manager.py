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

from db import db

logger = logging.getLogger(__name__)

CONNECTIONS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "connections_data.json")

class ConnectionsManager:
    def __init__(self, data_file: str = CONNECTIONS_FILE):
        self.data_file = data_file
        self.lock = threading.Lock()
        self._guests_cache = {}
        self._cache_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), "guests_cache.json")
        self._load_data()
        self._load_guests_cache()
        self._start_guests_prefetcher()

    def _load_guests_cache(self):
        try:
            cached = db.get_all_guests_cache()
            if cached:
                for sid, entry in cached.items():
                    cache_key = f"{entry.get('server_type', 'proxmox')}:{sid}"
                    self._guests_cache[cache_key] = {
                        "timestamp": entry.get("updated_at", time.time()),
                        "data": {
                            "success": True,
                            "server_id": sid,
                            "vms": entry.get("vms", []),
                            "cts": entry.get("cts", [])
                        }
                    }
                logger.info(f"Cache de guests carregado do SQLite: {len(self._guests_cache)} nós.")
                return

            if os.path.exists(self._cache_file):
                with open(self._cache_file, "r", encoding="utf-8") as f:
                    loaded = json.load(f)
                    if isinstance(loaded, dict):
                        self._guests_cache = loaded
                        logger.info(f"Cache persistente de guests carregado do JSON: {len(self._guests_cache)} nós.")
                        self._save_guests_cache()
        except Exception as e:
            logger.warning(f"Erro ao carregar cache de guests: {e}")

    def _save_guests_cache(self):
        try:
            for cache_key, entry in self._guests_cache.items():
                stype, sid = cache_key.split(":", 1) if ":" in cache_key else ("proxmox", cache_key)
                d = entry.get("data", {})
                db.save_guests_cache(sid, stype, d.get("vms", []), d.get("cts", []))

            # Backup secundário JSON
            tmp = self._cache_file + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self._guests_cache, f, indent=2, ensure_ascii=False)
            os.replace(tmp, self._cache_file)
        except Exception as e:
            logger.warning(f"Erro ao gravar guests_cache: {e}")

    def _start_guests_prefetcher(self):
        """Inicia thread background para manter a lista de VMs/CTs pré-carregada e imediata."""
        def worker():
            time.sleep(3) # Aguarda inicialização do sistema
            while True:
                try:
                    p_servers = []
                    v_servers = []
                    with self.lock:
                        p_servers = [s.get("id") for s in self.data.get("proxmox_servers", []) if s.get("enabled", True)]
                        v_servers = [s.get("id") for s in self.data.get("vmware_servers", []) if s.get("enabled", True)]

                    for sid in p_servers:
                        cache_key = f"proxmox:{sid}"
                        entry = self._guests_cache.get(cache_key)
                        if not entry or (time.time() - entry.get("timestamp", 0) > 120):
                            try:
                                self.get_proxmox_guests(sid, force_refresh=True)
                            except Exception as ex:
                                logger.debug(f"Prefetch Proxmox {sid}: {ex}")
                        time.sleep(1)

                    for sid in v_servers:
                        cache_key = f"vmware:{sid}"
                        entry = self._guests_cache.get(cache_key)
                        if not entry or (time.time() - entry.get("timestamp", 0) > 120):
                            try:
                                self.get_vmware_guests(sid, force_refresh=True)
                            except Exception as ex:
                                logger.debug(f"Prefetch VMware {sid}: {ex}")
                        time.sleep(1)

                except Exception as e:
                    logger.error(f"Erro no loop de prefetch de guests: {e}")

                time.sleep(120)

        t = threading.Thread(target=worker, daemon=True, name="GuestsPrefetcherThread")
        t.start()

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
                    "host": "smtp.office365.com",
                    "port": 587,
                    "security_mode": "starttls",
                    "use_tls": True,
                    "username": "alerts@enging.pt",
                    "password": "",
                    "from_name": "Enging UPS System",
                    "from_email": "alerts@enging.pt",
                    "reply_to": "",
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
            try:
                db_conns = db.get_all_connections()
                if db_conns.get("proxmox_servers") or db_conns.get("vmware_servers"):
                    self.data = db_conns
                    logger.info("Conexões carregadas com sucesso a partir da base SQLite.")
                    return
            except Exception as e:
                logger.warning(f"Erro ao ler conexões do SQLite: {e}")

            if os.path.exists(self.data_file):
                try:
                    with open(self.data_file, "r", encoding="utf-8") as f:
                        self.data = json.load(f)
                    logger.info("Conexões carregadas a partir de connections_data.json. A sincronizar com SQLite...")
                    self._save_data_no_lock()
                    return
                except Exception as e:
                    logger.error(f"Erro ao carregar ficheiro de conexões ({self.data_file}): {e}")

            self.data = self._get_default_data()
            self._save_data_no_lock()

    def _save_data_no_lock(self):
        try:
            if "nut_server" in self.data:
                db.save_system_setting("nut_server", self.data["nut_server"])
            if "messaging_gateways" in self.data:
                db.save_system_setting("messaging_gateways", self.data["messaging_gateways"])
            for p in self.data.get("proxmox_servers", []):
                db.save_proxmox_server(p)
            for v in self.data.get("vmware_servers", []):
                db.save_vmware_server(v)
            for t in self.data.get("api_tokens", []):
                db.save_api_token(t)

            # Backup JSON secundário para compatibilidade
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
            try:
                db.delete_proxmox_server(server_id)
            except Exception as e:
                logger.warning(f"Erro ao deletar Proxmox do SQLite: {e}")
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
            try:
                db.delete_vmware_server(server_id)
            except Exception as e:
                logger.warning(f"Erro ao deletar VMware do SQLite: {e}")
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
            try:
                db.delete_api_token(token_id)
            except Exception as e:
                logger.warning(f"Erro ao deletar token do SQLite: {e}")
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


    # --- SERVERS & GUESTS (VMs / CTs) FOR SHUTDOWN AUTOMATION ---

    def get_registered_servers(self) -> Dict[str, Any]:
        """Retorna lista resumida de todos os servidores registrados (Proxmox, VMware e NUT)."""
        with self.lock:
            proxmox = []
            for p in self.data.get("proxmox_servers", []):
                proxmox.append({
                    "id": p.get("id"),
                    "name": p.get("name", "Proxmox"),
                    "host": p.get("host"),
                    "port": p.get("port", 22),
                    "node_name": p.get("node_name", "pve"),
                    "type": "proxmox",
                    "status": p.get("status", "unknown"),
                    "enabled": p.get("enabled", True),
                    "mac_address": p.get("mac_address", ""),
                    "wol_broadcast": p.get("wol_broadcast", "255.255.255.255"),
                    "ipmi_host": p.get("ipmi_host", "")
                })

            vmware = []
            for v in self.data.get("vmware_servers", []):
                vmware.append({
                    "id": v.get("id"),
                    "name": v.get("name", "VMware ESXi"),
                    "host": v.get("host"),
                    "port": v.get("port", 443),
                    "type": "vmware",
                    "status": v.get("status", "unknown"),
                    "enabled": v.get("enabled", True),
                    "mac_address": v.get("mac_address", ""),
                    "wol_broadcast": v.get("wol_broadcast", "255.255.255.255"),
                    "ipmi_host": v.get("ipmi_host", "")
                })

            nut = {
                "name": "Servidor Local NUT (10.255.255.28)",
                "host": "127.0.0.1",
                "port": 22,
                "type": "local",
                "status": "online"
            }

            return {
                "proxmox": proxmox,
                "vmware": vmware,
                "nut_local": nut
            }

    def get_server_credentials(self, server_type: str, server_id: str) -> Optional[Dict[str, Any]]:
        """Retorna credenciais completas nao-mascaradas para conexoes SSH/shutdown."""
        with self.lock:
            if server_type == "proxmox":
                for s in self.data.get("proxmox_servers", []):
                    if s.get("id") == server_id:
                        return {
                            "host": s.get("host"),
                            "port": int(s.get("port", 22)),
                            "username": s.get("username", "root"),
                            "password": s.get("password", ""),
                            "private_key": s.get("private_key", ""),
                            "sudo": s.get("sudo", False),
                            "auth_type": s.get("auth_type", "password"),
                            "mac_address": s.get("mac_address", ""),
                            "wol_broadcast": s.get("wol_broadcast", "255.255.255.255"),
                            "ipmi_host": s.get("ipmi_host", ""),
                            "ipmi_user": s.get("ipmi_user", "admin"),
                            "ipmi_password": s.get("ipmi_password", "")
                        }
            elif server_type == "vmware":
                for s in self.data.get("vmware_servers", []):
                    if s.get("id") == server_id:
                        return {
                            "host": s.get("host"),
                            "port": 22,
                            "username": s.get("username", "root"),
                            "password": s.get("password", ""),
                            "sudo": False,
                            "auth_type": "password",
                            "mac_address": s.get("mac_address", ""),
                            "wol_broadcast": s.get("wol_broadcast", "255.255.255.255"),
                            "ipmi_host": s.get("ipmi_host", ""),
                            "ipmi_user": s.get("ipmi_user", "admin"),
                            "ipmi_password": s.get("ipmi_password", "")
                        }
            elif server_type == "local":
                return {
                    "host": "127.0.0.1",
                    "port": 22,
                    "username": "root",
                    "password": "",
                    "sudo": True,
                    "auth_type": "password"
                }
        return None

    def get_proxmox_guests(self, server_id: str, force_refresh: bool = False) -> Dict[str, Any]:
        """Consulta via SSH ao Proxmox as VMs (QEMU) e CTs (LXC) ativas e configuradas de forma ultra-rápida e resiliente."""
        cache_key = f"proxmox:{server_id}"
        if not force_refresh and cache_key in self._guests_cache:
            entry = self._guests_cache[cache_key]
            if time.time() - entry.get("timestamp", 0) < 300:
                return entry["data"]

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
            return {"success": False, "message": "Módulo SSH (paramiko) indisponível"}

        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            connect_kwargs = {
                "hostname": host,
                "port": port,
                "username": username,
                "timeout": 7
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

            # Comando de sondagem híbrido:
            # 1. Lê os arquivos de configuração canónicos de /etc/pve (ultra-rápido, infalível e independente de Ceph/Storage)
            # 2. Obtém os PIDs de VMs e CTs em execução via pgrep / ps
            # 3. Tenta qm list e pct list com timeout estrito de 3s para complementar métricas se disponível
            smart_cmd = r"""
echo '===CONF_QEMU==='
for f in /etc/pve/qemu-server/*.conf /etc/pve/nodes/*/qemu-server/*.conf; do
    if [ -f "$f" ]; then
        vmid=$(basename "$f" .conf)
        name=$(grep -E '^\s*name\s*:' "$f" | head -1 | awk '{$1=""; print $0}' | sed 's/^ //')
        [ -z "$name" ] && name="VM-$vmid"
        echo "$vmid|$name"
    fi
done
echo '===CONF_LXC==='
for f in /etc/pve/lxc/*.conf /etc/pve/nodes/*/lxc/*.conf; do
    if [ -f "$f" ]; then
        vmid=$(basename "$f" .conf)
        name=$(grep -E '^\s*(hostname|name)\s*:' "$f" | head -1 | awk '{$1=""; print $0}' | sed 's/^ //')
        [ -z "$name" ] && name="CT-$vmid"
        echo "$vmid|$name"
    fi
done
echo '===RUNNING==='
pgrep -a kvm | grep -oE -- '-id [0-9]+' | awk '{print "RUN_VM:"$2}'
pgrep -a lxc-start | grep -oE -- '-n [0-9]+' | awk '{print "RUN_CT:"$2}'
echo '===CLI_QM==='
if command -v timeout >/dev/null 2>&1; then
    timeout 3 qm list 2>/dev/null
else
    qm list 2>/dev/null
fi
echo '===CLI_PCT==='
if command -v timeout >/dev/null 2>&1; then
    timeout 3 pct list 2>/dev/null
else
    pct list 2>/dev/null
fi
"""
            _, o_all, _ = ssh.exec_command(smart_cmd)
            all_output = o_all.read().decode('utf-8', errors='ignore')
            ssh.close()

            parts = {}
            current_tag = None
            for line in all_output.splitlines():
                line_str = line.strip()
                if line_str.startswith("===") and line_str.endswith("==="):
                    current_tag = line_str.replace("===", "")
                    parts[current_tag] = []
                elif current_tag:
                    parts[current_tag].append(line_str)

            running_vms = set()
            running_cts = set()
            for line in parts.get("RUNNING", []):
                if line.startswith("RUN_VM:"):
                    running_vms.add(line.split(":", 1)[1].strip())
                elif line.startswith("RUN_CT:"):
                    running_cts.add(line.split(":", 1)[1].strip())

            cli_vms = {}
            for line in parts.get("CLI_QM", []):
                if not line or line.upper().startswith("VMID"):
                    continue
                spl = line.split()
                if len(spl) >= 3:
                    vmid = spl[0]
                    cli_vms[vmid] = {
                        "id": vmid,
                        "name": spl[1],
                        "status": spl[2].lower(),
                        "type": "qemu",
                        "mem": spl[3] if len(spl) > 3 else "",
                        "disk": spl[4] if len(spl) > 4 else ""
                    }

            cli_cts = {}
            for line in parts.get("CLI_PCT", []):
                if not line or line.upper().startswith("VMID"):
                    continue
                spl = line.split()
                if len(spl) >= 3:
                    vmid = spl[0]
                    cli_cts[vmid] = {
                        "id": vmid,
                        "status": spl[1].lower(),
                        "name": spl[-1],
                        "lock": spl[2] if len(spl) > 3 else "",
                        "type": "lxc"
                    }

            vms_dict = {}
            for line in parts.get("CONF_QEMU", []):
                if "|" in line:
                    vmid, name = line.split("|", 1)
                    vmid = vmid.strip()
                    name = name.strip()
                    is_run = (vmid in running_vms) or (vmid in cli_vms and cli_vms[vmid]["status"] == "running")
                    cli_entry = cli_vms.get(vmid, {})
                    vms_dict[vmid] = {
                        "id": vmid,
                        "name": name or cli_entry.get("name") or f"VM-{vmid}",
                        "status": "running" if is_run else "stopped",
                        "type": "qemu",
                        "mem": cli_entry.get("mem", ""),
                        "disk": cli_entry.get("disk", "")
                    }

            for vmid, entry in cli_vms.items():
                if vmid not in vms_dict:
                    vms_dict[vmid] = entry

            cts_dict = {}
            for line in parts.get("CONF_LXC", []):
                if "|" in line:
                    vmid, name = line.split("|", 1)
                    vmid = vmid.strip()
                    name = name.strip()
                    is_run = (vmid in running_cts) or (vmid in cli_cts and cli_cts[vmid]["status"] == "running")
                    cli_entry = cli_cts.get(vmid, {})
                    cts_dict[vmid] = {
                        "id": vmid,
                        "name": name or cli_entry.get("name") or f"CT-{vmid}",
                        "status": "running" if is_run else "stopped",
                        "type": "lxc",
                        "lock": cli_entry.get("lock", "")
                    }

            for vmid, entry in cli_cts.items():
                if vmid not in cts_dict:
                    cts_dict[vmid] = entry

            vms = sorted(list(vms_dict.values()), key=lambda x: int(x["id"]) if x["id"].isdigit() else str(x["id"]))
            cts = sorted(list(cts_dict.values()), key=lambda x: int(x["id"]) if x["id"].isdigit() else str(x["id"]))

            result_data = {
                "success": True,
                "server": {
                    "id": server_id,
                    "name": server.get("name"),
                    "host": host,
                    "type": "proxmox"
                },
                "vms": vms,
                "cts": cts,
                "total_vms": len(vms),
                "total_cts": len(cts),
                "running_vms": sum(1 for v in vms if v["status"] == "running"),
                "running_cts": sum(1 for c in cts if c["status"] == "running")
            }
            self._guests_cache[cache_key] = {"timestamp": time.time(), "data": result_data}
            self._save_guests_cache()
            return result_data

        except Exception as e:
            if cache_key in self._guests_cache:
                fallback_data = dict(self._guests_cache[cache_key]["data"])
                fallback_data["_cached_fallback"] = True
                fallback_data["_warning"] = f"Aviso: Usando dados em cache devido a erro de conexão: {str(e)}"
                return fallback_data

            return {
                "success": False,
                "server": {"id": server_id, "name": server.get("name"), "host": host},
                "error": str(e),
                "message": f"Erro ao comunicar com {server.get('name')} ({host}): {str(e)}"
            }

    def get_vmware_guests(self, server_id: str, force_refresh: bool = False) -> Dict[str, Any]:
        """Consulta via SSH ao VMware ESXi as VMs registradas e seus estados de execução."""
        cache_key = f"vmware:{server_id}"
        if not force_refresh and cache_key in self._guests_cache:
            entry = self._guests_cache[cache_key]
            if time.time() - entry.get("timestamp", 0) < 300:
                return entry["data"]
        server = None
        with self.lock:
            for s in self.data.get("vmware_servers", []):
                if s.get("id") == server_id:
                    server = dict(s)
                    break

        if not server:
            return {"success": False, "message": "Servidor VMware não encontrado"}

        host = server.get("host")
        username = server.get("username", "root")
        password = server.get("password", "")

        if not paramiko:
            return {"success": False, "message": "Módulo SSH (paramiko) indisponível"}

        ssh = paramiko.SSHClient()
        ssh.set_missing_host_key_policy(paramiko.AutoAddPolicy())

        try:
            ssh.connect(host, port=22, username=username, password=password, timeout=7)
            _, o_all, _ = ssh.exec_command("vim-cmd vmsvc/getallvms 2>/dev/null; echo '===PROC_SEPARATOR==='; esxcli vm process list 2>/dev/null")
            all_output = o_all.read().decode('utf-8', errors='ignore')
            ssh.close()

            parts_out = all_output.split('===PROC_SEPARATOR===')
            vms_output = parts_out[0] if len(parts_out) > 0 else ''
            proc_output = parts_out[1] if len(parts_out) > 1 else ''

            running_names = set()
            for line in proc_output.splitlines():
                if "Display Name:" in line:
                    dname = line.split("Display Name:", 1)[1].strip()
                    running_names.add(dname)

            vms = []
            for line in vms_output.strip().splitlines():
                line = line.strip()
                if not line or line.upper().startswith("VMID"):
                    continue
                parts = line.split()
                if len(parts) >= 2:
                    vmid = parts[0]
                    name = parts[1]
                    status = "running" if name in running_names else "stopped"
                    vms.append({
                        "id": vmid,
                        "name": name,
                        "status": status,
                        "type": "vmware_vm"
                    })

            vms = sorted(vms, key=lambda x: int(x["id"]) if x["id"].isdigit() else str(x["id"]))

            result_data = {
                "success": True,
                "server": {
                    "id": server_id,
                    "name": server.get("name"),
                    "host": host,
                    "type": "vmware"
                },
                "vms": vms,
                "cts": [],
                "total_vms": len(vms),
                "total_cts": 0,
                "running_vms": sum(1 for v in vms if v["status"] == "running"),
                "running_cts": 0
            }
            self._guests_cache[cache_key] = {"timestamp": time.time(), "data": result_data}
            self._save_guests_cache()
            return result_data

        except Exception as e:
            if cache_key in self._guests_cache:
                fallback_data = dict(self._guests_cache[cache_key]["data"])
                fallback_data["_cached_fallback"] = True
                fallback_data["_warning"] = f"Aviso: Usando dados em cache devido a erro de conexão: {str(e)}"
                return fallback_data

            return {
                "success": False,
                "server": {"id": server_id, "name": server.get("name"), "host": host},
                "error": str(e),
                "message": f"Erro ao comunicar com VMware {server.get('name')} ({host}): {str(e)}"
            }
