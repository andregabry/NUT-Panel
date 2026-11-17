import os
import json
import time
import sqlite3
import threading
import logging
import uuid
from typing import Dict, Any, List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ups_system.db")

class Database:
    _instance = None
    _lock = threading.Lock()

    def __new__(cls, *args, **kwargs):
        with cls._lock:
            if cls._instance is None:
                cls._instance = super(Database, cls).__new__(cls)
                cls._instance._initialized = False
            return cls._instance

    def __init__(self, db_path: str = DB_PATH):
        if getattr(self, "_initialized", False):
            return
        self.db_path = db_path
        self._local = threading.local()
        self._init_db()
        self._initialized = True

    def get_connection(self) -> sqlite3.Connection:
        if not hasattr(self._local, "conn") or self._local.conn is None:
            conn = sqlite3.connect(self.db_path, timeout=30.0, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode=WAL;")
            conn.execute("PRAGMA synchronous=NORMAL;")
            conn.execute("PRAGMA foreign_keys=ON;")
            self._local.conn = conn
        return self._local.conn

    def _init_db(self):
        conn = self.get_connection()
        cur = conn.cursor()

        # 1. Tabela de Utilizadores
        cur.execute("""
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY COLLATE NOCASE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL DEFAULT 'admin',
                created_at TEXT,
                updated_at TEXT
            )
        """)

        # 2. Telemetria e Histórico da UPS
        cur.execute("""
            CREATE TABLE IF NOT EXISTS telemetry_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                formatted_time TEXT NOT NULL,
                load_pct REAL,
                real_power_w REAL,
                input_voltage REAL,
                output_voltage REAL,
                battery_charge REAL,
                battery_voltage REAL,
                status_raw TEXT
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_telemetry_time ON telemetry_history(timestamp);")

        # 3. Conexões de Hipervisores e APIs
        cur.execute("""
            CREATE TABLE IF NOT EXISTS proxmox_servers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER DEFAULT 22,
                node_name TEXT DEFAULT 'pve',
                auth_type TEXT DEFAULT 'password',
                realm TEXT DEFAULT 'pam',
                token_id TEXT,
                token_secret TEXT,
                username TEXT DEFAULT 'root',
                password TEXT,
                private_key TEXT,
                sudo INTEGER DEFAULT 0,
                verify_ssl INTEGER DEFAULT 0,
                enabled INTEGER DEFAULT 1,
                mac_address TEXT,
                wol_broadcast TEXT DEFAULT '255.255.255.255',
                ipmi_host TEXT,
                ipmi_user TEXT DEFAULT 'admin',
                ipmi_password TEXT,
                status TEXT DEFAULT 'idle',
                last_test_json TEXT
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS vmware_servers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                host TEXT NOT NULL,
                port INTEGER DEFAULT 22,
                type TEXT DEFAULT 'esxi',
                auth_type TEXT DEFAULT 'password',
                username TEXT DEFAULT 'root',
                password TEXT,
                verify_ssl INTEGER DEFAULT 0,
                enabled INTEGER DEFAULT 1,
                mac_address TEXT,
                wol_broadcast TEXT DEFAULT '255.255.255.255',
                ipmi_host TEXT,
                ipmi_user TEXT DEFAULT 'admin',
                ipmi_password TEXT,
                status TEXT DEFAULT 'idle',
                last_test_json TEXT
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS api_tokens (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                token TEXT NOT NULL,
                prefix TEXT NOT NULL,
                permissions TEXT NOT NULL DEFAULT 'read_write',
                created_at TEXT,
                last_used TEXT,
                enabled INTEGER DEFAULT 1
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS system_settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS guests_cache (
                server_id TEXT PRIMARY KEY,
                server_type TEXT NOT NULL,
                vms_json TEXT,
                cts_json TEXT,
                updated_at REAL NOT NULL
            )
        """)

        # 4. Planos de Desligamento e Alvos
        cur.execute("""
            CREATE TABLE IF NOT EXISTS plans (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                trigger_battery_pct REAL DEFAULT 30.0,
                grace_period_sec INTEGER DEFAULT 10,
                require_on_battery INTEGER DEFAULT 1,
                enabled INTEGER DEFAULT 1,
                auto_poweron_enabled INTEGER DEFAULT 1,
                poweron_min_battery_pct REAL DEFAULT 35.0,
                poweron_min_stable_sec INTEGER DEFAULT 120,
                poweron_delay_sec INTEGER DEFAULT 5,
                notifications_json TEXT,
                state_json TEXT,
                created_at TEXT
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS plan_servers (
                id TEXT PRIMARY KEY,
                plan_id TEXT NOT NULL,
                name TEXT NOT NULL,
                connection_id TEXT,
                connection_type TEXT,
                host TEXT,
                port INTEGER DEFAULT 22,
                method TEXT DEFAULT 'ssh',
                username TEXT DEFAULT 'root',
                password TEXT,
                private_key TEXT,
                sudo INTEGER DEFAULT 0,
                custom_command TEXT,
                delay_sec INTEGER DEFAULT 0,
                enabled INTEGER DEFAULT 1,
                shutdown_host INTEGER DEFAULT 0,
                wol_mac TEXT,
                wol_broadcast TEXT DEFAULT '255.255.255.255',
                ipmi_host TEXT,
                ipmi_user TEXT,
                ipmi_pass TEXT,
                webhook_url TEXT,
                webhook_method TEXT DEFAULT 'POST',
                selected_guests_json TEXT,
                last_test_json TEXT,
                FOREIGN KEY(plan_id) REFERENCES plans(id) ON DELETE CASCADE
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_plan_srv_plan ON plan_servers(plan_id);")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS shutdown_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp REAL NOT NULL,
                formatted_time TEXT NOT NULL,
                level TEXT NOT NULL,
                server TEXT,
                message TEXT NOT NULL
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_shutdown_logs_time ON shutdown_logs(timestamp);")

        # 5. Central de Alertas e Notificações
        cur.execute("""
            CREATE TABLE IF NOT EXISTS alert_rules (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                trigger_type TEXT NOT NULL,
                threshold_val REAL DEFAULT 0,
                threshold_val_max REAL DEFAULT 0,
                require_duration_sec INTEGER DEFAULT 0,
                cooldown_min REAL DEFAULT 15,
                enabled INTEGER DEFAULT 1,
                channels_json TEXT,
                recipient_ids_json TEXT,
                custom_message TEXT,
                last_notified REAL DEFAULT 0
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS recipients (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT,
                phone_whatsapp TEXT,
                phone_sms TEXT,
                webhook_url TEXT,
                enabled INTEGER DEFAULT 1,
                notes TEXT
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS alert_logs (
                id TEXT PRIMARY KEY,
                timestamp REAL NOT NULL,
                formatted_time TEXT NOT NULL,
                alert_name TEXT NOT NULL,
                recipient_name TEXT,
                channel TEXT,
                success INTEGER DEFAULT 1,
                message TEXT,
                detail TEXT
            )
        """)
        cur.execute("CREATE INDEX IF NOT EXISTS idx_alert_logs_time ON alert_logs(timestamp);")

        conn.commit()

    # ------------------------------------------------------------- #
    # AUTENTICAÇÃO E UTILIZADORES                                   #
    # ------------------------------------------------------------- #

    def get_users(self) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("SELECT username, password_hash, role, created_at, updated_at FROM users")
        return [dict(row) for row in cur.fetchall()]

    def get_user(self, username: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("SELECT username, password_hash, role, created_at, updated_at FROM users WHERE username = ?", (username.strip().lower(),))
        row = cur.fetchone()
        return dict(row) if row else None

    def save_user(self, username: str, password_hash: str, role: str = "admin") -> bool:
        conn = self.get_connection()
        cur = conn.cursor()
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        cur.execute("""
            INSERT INTO users (username, password_hash, role, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(username) DO UPDATE SET
                password_hash = excluded.password_hash,
                role = excluded.role,
                updated_at = excluded.updated_at
        """, (username.strip().lower(), password_hash, role, now, now))
        conn.commit()
        return True

    def update_password(self, username: str, new_hash: str) -> bool:
        conn = self.get_connection()
        cur = conn.cursor()
        now = time.strftime("%Y-%m-%d %H:%M:%S")
        cur.execute("UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ?", (new_hash, now, username.strip().lower()))
        conn.commit()
        return cur.rowcount > 0

    # ------------------------------------------------------------- #
    # TELEMETRIA E HISTÓRICO                                        #
    # ------------------------------------------------------------- #

    def add_telemetry(self, data: Dict[str, Any]):
        conn = self.get_connection()
        cur = conn.cursor()
        out = data.get("output", {})
        inp = data.get("input", {})
        batt = data.get("battery", {})
        cur.execute("""
            INSERT INTO telemetry_history 
            (timestamp, formatted_time, load_pct, real_power_w, input_voltage, output_voltage, battery_charge, battery_voltage, status_raw)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data.get("timestamp", time.time()),
            data.get("formatted_time", time.strftime("%H:%M:%S")),
            out.get("load_pct", 0),
            out.get("real_power_w", 0),
            inp.get("voltage", 0),
            out.get("voltage", 0),
            batt.get("charge_pct", 100),
            batt.get("voltage", 0),
            data.get("status", {}).get("raw", "")
        ))
        conn.commit()

        # Prune antigo: a cada 200 inserções, limpa dados com mais de 15 dias
        if data.get("timestamp", 0) % 200 < 2:
            cutoff = time.time() - (15 * 86400)
            cur.execute("DELETE FROM telemetry_history WHERE timestamp < ?", (cutoff,))
            conn.commit()

    def get_telemetry_history(self, limit: int = 120) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("""
            SELECT timestamp, formatted_time as time, load_pct, real_power_w, input_voltage, output_voltage, battery_charge, battery_voltage
            FROM telemetry_history ORDER BY id DESC LIMIT ?
        """, (limit,))
        rows = cur.fetchall()
        # Retorna em ordem cronológica (mais antigo primeiro)
        return [dict(r) for r in reversed(rows)]

    # ------------------------------------------------------------- #
    # CONEXÕES & SERVIDORES                                         #
    # ------------------------------------------------------------- #

    def get_all_connections(self) -> Dict[str, Any]:
        conn = self.get_connection()
        cur = conn.cursor()

        # Proxmox
        cur.execute("SELECT * FROM proxmox_servers")
        pve = []
        for r in cur.fetchall():
            d = dict(r)
            d["sudo"] = bool(d["sudo"])
            d["verify_ssl"] = bool(d["verify_ssl"])
            d["enabled"] = bool(d["enabled"])
            d["last_test"] = json.loads(d["last_test_json"]) if d.get("last_test_json") else None
            d.pop("last_test_json", None)
            pve.append(d)

        # VMware
        cur.execute("SELECT * FROM vmware_servers")
        vm = []
        for r in cur.fetchall():
            d = dict(r)
            d["verify_ssl"] = bool(d["verify_ssl"])
            d["enabled"] = bool(d["enabled"])
            d["last_test"] = json.loads(d["last_test_json"]) if d.get("last_test_json") else None
            d.pop("last_test_json", None)
            vm.append(d)

        # Tokens
        cur.execute("SELECT * FROM api_tokens")
        tokens = []
        for r in cur.fetchall():
            d = dict(r)
            d["enabled"] = bool(d["enabled"])
            tokens.append(d)

        # Settings
        cur.execute("SELECT key, value_json FROM system_settings WHERE key IN ('nut_server', 'messaging_gateways')")
        settings_map = {row["key"]: json.loads(row["value_json"]) for row in cur.fetchall()}

        return {
            "nut_server": settings_map.get("nut_server", {
                "name": "Servidor NUT Principal (USB)",
                "host": "127.0.0.1",
                "port": 3493,
                "ups_name": "ups",
                "username": "monuser",
                "password": "secret_password",
                "poll_interval": 1.5,
                "timeout": 5.0,
                "status": "online"
            }),
            "proxmox_servers": pve,
            "vmware_servers": vm,
            "messaging_gateways": settings_map.get("messaging_gateways", {}),
            "api_tokens": tokens
        }

    def save_proxmox_server(self, s: Dict[str, Any]) -> Dict[str, Any]:
        conn = self.get_connection()
        cur = conn.cursor()
        sid = s.get("id") or str(time.time()).replace(".", "")
        s["id"] = sid
        last_test = json.dumps(s.get("last_test")) if s.get("last_test") else None

        cur.execute("""
            INSERT INTO proxmox_servers 
            (id, name, host, port, node_name, auth_type, realm, token_id, token_secret, username, password, private_key, sudo, verify_ssl, enabled, mac_address, wol_broadcast, ipmi_host, ipmi_user, ipmi_password, status, last_test_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, host=excluded.host, port=excluded.port, node_name=excluded.node_name,
                auth_type=excluded.auth_type, realm=excluded.realm, token_id=excluded.token_id, token_secret=excluded.token_secret,
                username=excluded.username, password=excluded.password, private_key=excluded.private_key, sudo=excluded.sudo,
                verify_ssl=excluded.verify_ssl, enabled=excluded.enabled, mac_address=excluded.mac_address,
                wol_broadcast=excluded.wol_broadcast, ipmi_host=excluded.ipmi_host, ipmi_user=excluded.ipmi_user,
                ipmi_password=excluded.ipmi_password, status=excluded.status, last_test_json=excluded.last_test_json
        """, (
            sid, s.get("name"), s.get("host"), int(s.get("port", 22)), s.get("node_name", "pve"),
            s.get("auth_type", "password"), s.get("realm", "pam"), s.get("token_id", ""), s.get("token_secret", ""),
            s.get("username", "root"), s.get("password", ""), s.get("private_key", ""), int(bool(s.get("sudo"))),
            int(bool(s.get("verify_ssl"))), int(bool(s.get("enabled", True))), s.get("mac_address", ""),
            s.get("wol_broadcast", "255.255.255.255"), s.get("ipmi_host", ""), s.get("ipmi_user", "admin"),
            s.get("ipmi_password", ""), s.get("status", "idle"), last_test
        ))
        conn.commit()
        return s

    def delete_proxmox_server(self, server_id: str) -> bool:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM proxmox_servers WHERE id = ?", (server_id,))
        conn.commit()
        return cur.rowcount > 0

    def save_vmware_server(self, s: Dict[str, Any]) -> Dict[str, Any]:
        conn = self.get_connection()
        cur = conn.cursor()
        sid = s.get("id") or str(time.time()).replace(".", "")
        s["id"] = sid
        last_test = json.dumps(s.get("last_test")) if s.get("last_test") else None

        cur.execute("""
            INSERT INTO vmware_servers 
            (id, name, host, port, type, auth_type, username, password, verify_ssl, enabled, mac_address, wol_broadcast, ipmi_host, ipmi_user, ipmi_password, status, last_test_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, host=excluded.host, port=excluded.port, type=excluded.type,
                auth_type=excluded.auth_type, username=excluded.username, password=excluded.password,
                verify_ssl=excluded.verify_ssl, enabled=excluded.enabled, mac_address=excluded.mac_address,
                wol_broadcast=excluded.wol_broadcast, ipmi_host=excluded.ipmi_host, ipmi_user=excluded.ipmi_user,
                ipmi_password=excluded.ipmi_password, status=excluded.status, last_test_json=excluded.last_test_json
        """, (
            sid, s.get("name"), s.get("host"), int(s.get("port", 22)), s.get("type", "esxi"),
            s.get("auth_type", "password"), s.get("username", "root"), s.get("password", ""),
            int(bool(s.get("verify_ssl"))), int(bool(s.get("enabled", True))), s.get("mac_address", ""),
            s.get("wol_broadcast", "255.255.255.255"), s.get("ipmi_host", ""), s.get("ipmi_user", "admin"),
            s.get("ipmi_password", ""), s.get("status", "idle"), last_test
        ))
        conn.commit()
        return s

    def delete_vmware_server(self, server_id: str) -> bool:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM vmware_servers WHERE id = ?", (server_id,))
        conn.commit()
        return cur.rowcount > 0

    def save_system_setting(self, key: str, value: Any) -> bool:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO system_settings (key, value_json) VALUES (?, ?)
            ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json
        """, (key, json.dumps(value, ensure_ascii=False)))
        conn.commit()
        return True

    def get_system_setting(self, key: str, default: Any = None) -> Any:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("SELECT value_json FROM system_settings WHERE key = ?", (key,))
        row = cur.fetchone()
        return json.loads(row["value_json"]) if row else default

    def save_api_token(self, token_data: Dict[str, Any]) -> Dict[str, Any]:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO api_tokens (id, name, token, prefix, permissions, created_at, last_used, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, token=excluded.token, prefix=excluded.prefix,
                permissions=excluded.permissions, last_used=excluded.last_used, enabled=excluded.enabled
        """, (
            token_data["id"], token_data["name"], token_data["token"], token_data["prefix"],
            token_data.get("permissions", "read_write"), token_data.get("created_at"),
            token_data.get("last_used"), int(bool(token_data.get("enabled", True)))
        ))
        conn.commit()
        return token_data

    def delete_api_token(self, token_id: str) -> bool:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM api_tokens WHERE id = ?", (token_id,))
        conn.commit()
        return cur.rowcount > 0

    def save_guests_cache(self, server_id: str, server_type: str, vms: List[Any], cts: List[Any]):
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO guests_cache (server_id, server_type, vms_json, cts_json, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(server_id) DO UPDATE SET
                server_type=excluded.server_type, vms_json=excluded.vms_json,
                cts_json=excluded.cts_json, updated_at=excluded.updated_at
        """, (server_id, server_type, json.dumps(vms), json.dumps(cts), time.time()))
        conn.commit()

    def get_guests_cache(self, server_id: str) -> Optional[Dict[str, Any]]:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM guests_cache WHERE server_id = ?", (server_id,))
        row = cur.fetchone()
        if not row:
            return None
        return {
            "server_id": row["server_id"],
            "server_type": row["server_type"],
            "vms": json.loads(row["vms_json"]) if row["vms_json"] else [],
            "cts": json.loads(row["cts_json"]) if row["cts_json"] else [],
            "updated_at": row["updated_at"]
        }

    def get_all_guests_cache(self) -> Dict[str, Any]:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM guests_cache")
        out = {}
        for row in cur.fetchall():
            out[row["server_id"]] = {
                "server_id": row["server_id"],
                "server_type": row["server_type"],
                "vms": json.loads(row["vms_json"]) if row["vms_json"] else [],
                "cts": json.loads(row["cts_json"]) if row["cts_json"] else [],
                "updated_at": row["updated_at"]
            }
        return out

    # ------------------------------------------------------------- #
    # PLANOS DE DESLIGAMENTO E ALVOS                                #
    # ------------------------------------------------------------- #

    def get_plans(self) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM plans")
        plans = []
        for r in cur.fetchall():
            p = dict(r)
            p["require_on_battery"] = bool(p["require_on_battery"])
            p["enabled"] = bool(p["enabled"])
            p["auto_poweron_enabled"] = bool(p["auto_poweron_enabled"])
            p["notifications"] = json.loads(p["notifications_json"]) if p.get("notifications_json") else {}
            p["state"] = json.loads(p["state_json"]) if p.get("state_json") else {
                "status": "idle", "countdown_remaining": 0, "current_server": None, "triggered_at": None, "results": []
            }
            p.pop("notifications_json", None)
            p.pop("state_json", None)

            # Get servers
            cur.execute("SELECT * FROM plan_servers WHERE plan_id = ? ORDER BY delay_sec ASC", (p["id"],))
            srvs = []
            for s_row in cur.fetchall():
                s = dict(s_row)
                s["sudo"] = bool(s["sudo"])
                s["enabled"] = bool(s["enabled"])
                s["shutdown_host"] = bool(s["shutdown_host"])
                s["selected_guests"] = json.loads(s["selected_guests_json"]) if s.get("selected_guests_json") else []
                s["last_test"] = json.loads(s["last_test_json"]) if s.get("last_test_json") else None
                s.pop("selected_guests_json", None)
                s.pop("last_test_json", None)
                srvs.append(s)
            p["servers"] = srvs
            plans.append(p)
        return plans

    def get_plan(self, plan_id: str) -> Optional[Dict[str, Any]]:
        plans = self.get_plans()
        return next((p for p in plans if p["id"] == plan_id), None)

    def save_plan(self, p: Dict[str, Any]) -> Dict[str, Any]:
        conn = self.get_connection()
        cur = conn.cursor()
        pid = p.get("id") or str(time.time()).replace(".", "")
        p["id"] = pid
        notifs_json = json.dumps(p.get("notifications", {}))
        state_json = json.dumps(p.get("state", {
            "status": "idle", "countdown_remaining": 0, "current_server": None, "triggered_at": None, "results": []
        }))
        now = p.get("created_at") or time.strftime("%Y-%m-%d %H:%M:%S")

        cur.execute("""
            INSERT INTO plans 
            (id, name, description, trigger_battery_pct, grace_period_sec, require_on_battery, enabled, auto_poweron_enabled, poweron_min_battery_pct, poweron_min_stable_sec, poweron_delay_sec, notifications_json, state_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, description=excluded.description, trigger_battery_pct=excluded.trigger_battery_pct,
                grace_period_sec=excluded.grace_period_sec, require_on_battery=excluded.require_on_battery,
                enabled=excluded.enabled, auto_poweron_enabled=excluded.auto_poweron_enabled,
                poweron_min_battery_pct=excluded.poweron_min_battery_pct, poweron_min_stable_sec=excluded.poweron_min_stable_sec,
                poweron_delay_sec=excluded.poweron_delay_sec, notifications_json=excluded.notifications_json,
                state_json=excluded.state_json
        """, (
            pid, p.get("name", "Plano"), p.get("description", ""), float(p.get("trigger_battery_pct", 30)),
            int(p.get("grace_period_sec", 10)), int(bool(p.get("require_on_battery", True))), int(bool(p.get("enabled", True))),
            int(bool(p.get("auto_poweron_enabled", True))), float(p.get("poweron_min_battery_pct", 35)),
            int(p.get("poweron_min_stable_sec", 120)), int(p.get("poweron_delay_sec", 5)), notifs_json, state_json, now
        ))
        conn.commit()

        # If servers list is passed, sync plan_servers
        if "servers" in p:
            for s in p["servers"]:
                self.save_plan_server(pid, s)
        return self.get_plan(pid)

    def delete_plan(self, plan_id: str) -> bool:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM plan_servers WHERE plan_id = ?", (plan_id,))
        cur.execute("DELETE FROM plans WHERE id = ?", (plan_id,))
        conn.commit()
        return cur.rowcount > 0

    def update_plan_state(self, plan_id: str, state: Dict[str, Any]):
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE plans SET state_json = ? WHERE id = ?", (json.dumps(state), plan_id))
        conn.commit()

    def save_plan_server(self, plan_id: str, s: Dict[str, Any]) -> Dict[str, Any]:
        conn = self.get_connection()
        cur = conn.cursor()
        sid = s.get("id") or str(time.time()).replace(".", "")
        s["id"] = sid
        s["plan_id"] = plan_id
        guests_json = json.dumps(s.get("selected_guests", []))
        last_test_json = json.dumps(s.get("last_test")) if s.get("last_test") else None

        cur.execute("""
            INSERT INTO plan_servers 
            (id, plan_id, name, connection_id, connection_type, host, port, method, username, password, private_key, sudo, custom_command, delay_sec, enabled, shutdown_host, wol_mac, wol_broadcast, ipmi_host, ipmi_user, ipmi_pass, webhook_url, webhook_method, selected_guests_json, last_test_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, connection_id=excluded.connection_id, connection_type=excluded.connection_type,
                host=excluded.host, port=excluded.port, method=excluded.method, username=excluded.username,
                password=excluded.password, private_key=excluded.private_key, sudo=excluded.sudo,
                custom_command=excluded.custom_command, delay_sec=excluded.delay_sec, enabled=excluded.enabled,
                shutdown_host=excluded.shutdown_host, wol_mac=excluded.wol_mac, wol_broadcast=excluded.wol_broadcast,
                ipmi_host=excluded.ipmi_host, ipmi_user=excluded.ipmi_user, ipmi_pass=excluded.ipmi_pass,
                webhook_url=excluded.webhook_url, webhook_method=excluded.webhook_method,
                selected_guests_json=excluded.selected_guests_json, last_test_json=excluded.last_test_json
        """, (
            sid, plan_id, s.get("name", "Alvo"), s.get("connection_id"), s.get("connection_type"),
            s.get("host"), int(s.get("port", 22)), s.get("method", "ssh"), s.get("username", "root"),
            s.get("password"), s.get("private_key"), int(bool(s.get("sudo"))), s.get("custom_command"),
            int(s.get("delay_sec", 0)), int(bool(s.get("enabled", True))), int(bool(s.get("shutdown_host"))),
            s.get("wol_mac"), s.get("wol_broadcast", "255.255.255.255"), s.get("ipmi_host"), s.get("ipmi_user"),
            s.get("ipmi_pass"), s.get("webhook_url"), s.get("webhook_method", "POST"), guests_json, last_test_json
        ))
        conn.commit()
        return s

    def delete_plan_server(self, plan_id: str, server_id: str) -> bool:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM plan_servers WHERE plan_id = ? AND id = ?", (plan_id, server_id))
        conn.commit()
        return cur.rowcount > 0

    def add_shutdown_log(self, level: str, message: str, server_name: str = "Sistema"):
        conn = self.get_connection()
        cur = conn.cursor()
        now = time.time()
        cur.execute("""
            INSERT INTO shutdown_logs (timestamp, formatted_time, level, server, message)
            VALUES (?, ?, ?, ?, ?)
        """, (now, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), level, server_name, message))
        conn.commit()

        # Mantém até 500 logs recentes
        cur.execute("DELETE FROM shutdown_logs WHERE id NOT IN (SELECT id FROM shutdown_logs ORDER BY id DESC LIMIT 500)")
        conn.commit()

    def get_shutdown_logs(self, limit: int = 150) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("SELECT id, timestamp, formatted_time, level, server, message FROM shutdown_logs ORDER BY id DESC LIMIT ?", (limit,))
        return [dict(r) for r in cur.fetchall()]

    # ------------------------------------------------------------- #
    # REGRAS DE ALERTA E CONTATOS                                   #
    # ------------------------------------------------------------- #

    def get_alert_rules(self) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM alert_rules")
        rules = []
        for r in cur.fetchall():
            d = dict(r)
            d["enabled"] = bool(d["enabled"])
            d["channels"] = json.loads(d["channels_json"]) if d.get("channels_json") else []
            d["recipient_ids"] = json.loads(d["recipient_ids_json"]) if d.get("recipient_ids_json") else []
            d.pop("channels_json", None)
            d.pop("recipient_ids_json", None)
            rules.append(d)
        return rules

    def save_alert_rule(self, rule: Dict[str, Any]) -> Dict[str, Any]:
        conn = self.get_connection()
        cur = conn.cursor()
        rid = rule.get("id") or f"rule-{int(time.time() * 1000)}"
        rule["id"] = rid
        channels_json = json.dumps(rule.get("channels", []))
        rec_ids_json = json.dumps(rule.get("recipient_ids", []))

        # Recupera last_notified existente se não informado
        last_notif = rule.get("last_notified")
        if last_notif is None:
            cur.execute("SELECT last_notified FROM alert_rules WHERE id = ?", (rid,))
            existing = cur.fetchone()
            last_notif = existing["last_notified"] if existing else 0

        cur.execute("""
            INSERT INTO alert_rules 
            (id, name, description, trigger_type, threshold_val, threshold_val_max, require_duration_sec, cooldown_min, enabled, channels_json, recipient_ids_json, custom_message, last_notified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, description=excluded.description, trigger_type=excluded.trigger_type,
                threshold_val=excluded.threshold_val, threshold_val_max=excluded.threshold_val_max,
                require_duration_sec=excluded.require_duration_sec, cooldown_min=excluded.cooldown_min,
                enabled=excluded.enabled, channels_json=excluded.channels_json, recipient_ids_json=excluded.recipient_ids_json,
                custom_message=excluded.custom_message, last_notified=excluded.last_notified
        """, (
            rid, rule.get("name", "Alerta"), rule.get("description", ""), rule.get("trigger_type"),
            float(rule.get("threshold_val", 0)), float(rule.get("threshold_val_max", 0)),
            int(rule.get("require_duration_sec", 0)), float(rule.get("cooldown_min", 15)),
            int(bool(rule.get("enabled", True))), channels_json, rec_ids_json,
            rule.get("custom_message", ""), float(last_notif or 0)
        ))
        conn.commit()
        return rule

    def update_rule_last_notified(self, rule_id: str, last_notified_ts: float):
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("UPDATE alert_rules SET last_notified = ? WHERE id = ?", (last_notified_ts, rule_id))
        conn.commit()

    def delete_alert_rule(self, rule_id: str) -> bool:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM alert_rules WHERE id = ?", (rule_id,))
        conn.commit()
        return cur.rowcount > 0

    def get_recipients(self) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM recipients")
        recs = []
        for r in cur.fetchall():
            d = dict(r)
            d["enabled"] = bool(d["enabled"])
            recs.append(d)
        return recs

    def save_recipient(self, r: Dict[str, Any]) -> Dict[str, Any]:
        conn = self.get_connection()
        cur = conn.cursor()
        rid = r.get("id") or f"rec-{int(time.time() * 1000)}"
        r["id"] = rid
        cur.execute("""
            INSERT INTO recipients (id, name, email, phone_whatsapp, phone_sms, webhook_url, enabled, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name=excluded.name, email=excluded.email, phone_whatsapp=excluded.phone_whatsapp,
                phone_sms=excluded.phone_sms, webhook_url=excluded.webhook_url, enabled=excluded.enabled,
                notes=excluded.notes
        """, (
            rid, r.get("name", "Contato"), r.get("email", ""), r.get("phone_whatsapp", ""),
            r.get("phone_sms", ""), r.get("webhook_url", ""), int(bool(r.get("enabled", True))),
            r.get("notes", "")
        ))
        conn.commit()
        return r

    def delete_recipient(self, rec_id: str) -> bool:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("DELETE FROM recipients WHERE id = ?", (rec_id,))
        conn.commit()
        return cur.rowcount > 0

    def add_alert_log(self, alert_name: str, recipient_name: str, channel: str, success: bool, message: str, detail: str = "", log_id: Optional[str] = None):
        conn = self.get_connection()
        cur = conn.cursor()
        now = time.time()
        lid = log_id or f"log-{int(now * 1000)}-{uuid.uuid4().hex[:6]}"
        cur.execute("""
            INSERT INTO alert_logs (id, timestamp, formatted_time, alert_name, recipient_name, channel, success, message, detail)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING
        """, (
            lid, now, datetime.now().strftime("%Y-%m-%d %H:%M:%S"), alert_name, recipient_name,
            channel, int(bool(success)), message, detail
        ))
        conn.commit()

        # Mantém até 500 logs de alertas
        cur.execute("DELETE FROM alert_logs WHERE id NOT IN (SELECT id FROM alert_logs ORDER BY timestamp DESC LIMIT 500)")
        conn.commit()

    def get_alert_logs(self, limit: int = 150) -> List[Dict[str, Any]]:
        conn = self.get_connection()
        cur = conn.cursor()
        cur.execute("SELECT * FROM alert_logs ORDER BY timestamp DESC LIMIT ?", (limit,))
        logs = []
        for r in cur.fetchall():
            d = dict(r)
            d["success"] = bool(d["success"])
            logs.append(d)
        return logs

    # ------------------------------------------------------------- #
    # MIGRAÇÃO AUTOMÁTICA DOS FICHEIROS JSON EXISTENTES             #
    # ------------------------------------------------------------- #

    def migrate_from_json(self, base_dir: str):
        """Lê todos os ficheiros JSON existentes e importa os dados para o SQLite se ainda não tiverem sido importados."""
        logger.info(f"A verificar necessidade de migração de JSONs em {base_dir} para SQLite...")
        
        # 1. Utilizadores
        users_file = os.path.join(base_dir, "users.json")
        if os.path.exists(users_file):
            try:
                with open(users_file, "r", encoding="utf-8") as f:
                    u_data = json.load(f)
                for u in u_data.get("users", []):
                    self.save_user(u["username"], u["password_hash"], u.get("role", "admin"))
                logger.info("Migração de users.json concluída.")
            except Exception as e:
                logger.error(f"Erro ao migrar users.json: {e}")

        # 2. Conexões e APIs
        conn_file = os.path.join(base_dir, "connections_data.json")
        if os.path.exists(conn_file):
            try:
                with open(conn_file, "r", encoding="utf-8") as f:
                    c_data = json.load(f)
                if c_data.get("nut_server"):
                    self.save_system_setting("nut_server", c_data["nut_server"])
                if c_data.get("messaging_gateways"):
                    self.save_system_setting("messaging_gateways", c_data["messaging_gateways"])
                for p in c_data.get("proxmox_servers", []):
                    self.save_proxmox_server(p)
                for v in c_data.get("vmware_servers", []):
                    self.save_vmware_server(v)
                for t in c_data.get("api_tokens", []):
                    self.save_api_token(t)
                logger.info("Migração de connections_data.json concluída.")
            except Exception as e:
                logger.error(f"Erro ao migrar connections_data.json: {e}")

        # 3. Planos de Desligamento
        plans_file = os.path.join(base_dir, "shutdown_plans.json")
        if not os.path.exists(plans_file):
            plans_file = os.path.join(base_dir, "shutdown_plan.json")
        if os.path.exists(plans_file):
            try:
                with open(plans_file, "r", encoding="utf-8") as f:
                    p_data = json.load(f)
                for p in p_data.get("plans", []):
                    self.save_plan(p)
                for l in p_data.get("logs", []):
                    self.add_shutdown_log(l.get("level", "info"), l.get("message", ""), l.get("server", "Sistema"))
                logger.info(f"Migração de {os.path.basename(plans_file)} concluída.")
            except Exception as e:
                logger.error(f"Erro ao migrar planos: {e}")

        # 4. Alertas e Regras
        alerts_file = os.path.join(base_dir, "alerts_data.json")
        if os.path.exists(alerts_file):
            try:
                with open(alerts_file, "r", encoding="utf-8") as f:
                    a_data = json.load(f)
                if a_data.get("channel_settings"):
                    self.save_system_setting("channel_settings", a_data["channel_settings"])
                for r in a_data.get("recipients", []):
                    self.save_recipient(r)
                for rule in a_data.get("rules", []):
                    self.save_alert_rule(rule)
                for l in a_data.get("logs", []):
                    self.add_alert_log(
                        l.get("alert_name", "Alerta"), l.get("recipient_name", ""),
                        l.get("channel", ""), l.get("success", True),
                        l.get("message", ""), l.get("detail", ""),
                        log_id=l.get("id")
                    )
                logger.info("Migração de alerts_data.json concluída.")
            except Exception as e:
                logger.error(f"Erro ao migrar alerts_data.json: {e}")

        # 5. Guests Cache
        cache_file = os.path.join(base_dir, "guests_cache.json")
        if os.path.exists(cache_file):
            try:
                with open(cache_file, "r", encoding="utf-8") as f:
                    g_data = json.load(f)
                for sid, entry in g_data.items():
                    self.save_guests_cache(sid, entry.get("server_type", "proxmox"), entry.get("vms", []), entry.get("cts", []))
                logger.info("Migração de guests_cache.json concluída.")
            except Exception as e:
                logger.error(f"Erro ao migrar guests_cache.json: {e}")

# Instância Singleton Global
db = Database()
