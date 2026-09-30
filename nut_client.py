import socket
import logging
import time
from typing import Dict, Any, Optional

logger = logging.getLogger(__name__)

class NutClient:
    def __init__(self, host: str, port: int = 3493, ups_name: str = "ups", 
                 username: Optional[str] = None, password: Optional[str] = None, timeout: float = 3.0):
        self.host = host
        self.port = port
        self.ups_name = ups_name
        self.username = username
        self.password = password
        self.timeout = timeout
        self.sock: Optional[socket.socket] = None

    def _connect(self) -> None:
        if self.sock:
            try:
                self.sock.close()
            except Exception:
                pass
            self.sock = None
            
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        s.connect((self.host, self.port))
        self.sock = s
        
        # Opcional: Autenticação se fornecida
        if self.username and self.password:
            try:
                self._send_cmd(f"USERNAME {self.username}")
                self._send_cmd(f"PASSWORD {self.password}")
            except Exception as e:
                logger.warning(f"Auth notice: {e}")

    def _send_cmd(self, cmd: str) -> str:
        if not self.sock:
            self._connect()
        self.sock.sendall((cmd.strip() + "\n").encode("utf-8"))
        res = b""
        while True:
            chunk = self.sock.recv(4096)
            if not chunk:
                break
            res += chunk
            if b"\n" in chunk:
                break
        return res.decode("utf-8", errors="ignore").strip()

    def get_all_vars(self) -> Dict[str, Any]:
        """Lê todas as variáveis do servidor NUT para a UPS especificada."""
        try:
            self._connect()
            self.sock.sendall(f"LIST VAR {self.ups_name}\n".encode("utf-8"))
            
            f = self.sock.makefile("r", encoding="utf-8", errors="ignore")
            raw_vars: Dict[str, str] = {}
            
            for line in f:
                line = line.strip()
                if line.startswith("VAR "):
                    # Formato: VAR ups name "value"
                    parts = line.split(" ", 3)
                    if len(parts) >= 4:
                        var_key = parts[2]
                        var_val = parts[3].strip('"')
                        raw_vars[var_key] = var_val
                elif line.startswith("END LIST VAR") or line.startswith("ERR"):
                    break
                    
            return self._parse_nut_data(raw_vars)
        except Exception as e:
            logger.error(f"Erro ao consultar NUT ({self.host}:{self.port}): {e}")
            raise
        finally:
            if self.sock:
                try:
                    self.sock.close()
                except Exception:
                    pass
                self.sock = None

    def _safe_float(self, val: Any, default: float = 0.0) -> float:
        try:
            return round(float(val), 2)
        except (ValueError, TypeError):
            return default

    def _safe_int(self, val: Any, default: int = 0) -> int:
        try:
            return int(float(val))
        except (ValueError, TypeError):
            return default

    def _parse_nut_data(self, raw: Dict[str, str]) -> Dict[str, Any]:
        """Estrutura os dados brutos do NUT num formato limpo e tipado para a UI."""
        status_str = raw.get("ups.status", "UNKNOWN")
        alarm_str = raw.get("ups.alarm", "")

        status_flags = status_str.split()
        is_online = "OL" in status_flags
        is_on_battery = "OB" in status_flags
        is_low_battery = "LB" in status_flags
        is_bypass = "BYPASS" in status_flags or "RB" in status_flags
        is_charging = "CHRG" in status_flags
        is_discharging = "DISCHRG" in status_flags
        has_alarm = "ALARM" in status_flags or bool(alarm_str)

        # Status legível
        if is_on_battery:
            state_label = "Em Bateria (Falta de Rede)"
            state_color = "amber"
        elif is_bypass:
            state_label = "Em Modo Bypass"
            state_color = "orange"
        elif is_online:
            state_label = "Online (Normal)"
            state_color = "emerald"
        else:
            state_label = status_str
            state_color = "slate"

        load_pct = self._safe_float(raw.get("ups.load", 0))
        real_power = self._safe_float(raw.get("ups.realpower", 0))
        apparent_power = self._safe_float(raw.get("ups.power", 0))
        
        # Se realpower não estiver disponível mas houver load, estimar com base nos 6000W
        if real_power == 0 and load_pct > 0:
            real_power = round((load_pct / 100.0) * 6000.0, 1)

        return {
            "timestamp": time.time(),
            "formatted_time": time.strftime("%H:%M:%S"),
            "connected": True,
            "device": {
                "name": self.ups_name,
                "model": raw.get("device.model", raw.get("ups.model", "INVT HT1106XS")),
                "mfr": raw.get("device.mfr", raw.get("ups.mfr", "INVT")),
                "type": raw.get("device.type", "ups"),
                "rated_power_va": 6000,
                "rated_power_w": 6000,
                "driver": raw.get("driver.name", "invt_modbus"),
                "driver_version": raw.get("driver.version", "2.8.1")
            },
            "status": {
                "raw": status_str,
                "label": state_label,
                "color": state_color,
                "flags": status_flags,
                "is_online": is_online,
                "is_on_battery": is_on_battery,
                "is_low_battery": is_low_battery,
                "is_bypass": is_bypass,
                "is_charging": is_charging,
                "is_discharging": is_discharging,
                "has_alarm": has_alarm,
                "alarm_text": alarm_str
            },
            "battery": {
                "charge_pct": self._safe_float(raw.get("battery.charge", 0)),
                "voltage": self._safe_float(raw.get("battery.voltage", 0)),
                "current": self._safe_float(raw.get("battery.current", 0)),
                "estimated_runtime_min": None # Não fornecido pelo driver, mas calculável se necessário
            },
            "input": {
                "voltage": self._safe_float(raw.get("input.voltage", 0)),
                "current": self._safe_float(raw.get("input.current", 0)),
                "frequency": self._safe_float(raw.get("input.frequency", 0)),
                "power_factor": self._safe_float(raw.get("input.powerfactor", 0)),
                "phases": self._safe_int(raw.get("input.phases", 1))
            },
            "bypass": {
                "voltage": self._safe_float(raw.get("input.bypass.voltage", 0)),
                "frequency": self._safe_float(raw.get("input.bypass.frequency", 0))
            },
            "output": {
                "voltage": self._safe_float(raw.get("output.voltage", 0)),
                "current": self._safe_float(raw.get("output.current", 0)),
                "frequency": self._safe_float(raw.get("output.frequency", 0)),
                "power_factor": self._safe_float(raw.get("output.powerfactor", 0)),
                "phases": self._safe_int(raw.get("output.phases", 1)),
                "load_pct": load_pct,
                "real_power_w": real_power,
                "apparent_power_va": apparent_power
            },
            "raw_vars": raw
        }
