import os
import json
import time
import logging
from typing import Dict, Any, List, Optional
from werkzeug.security import generate_password_hash, check_password_hash

logger = logging.getLogger(__name__)

USERS_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "users.json")

class AuthManager:
    def __init__(self, users_file: str = USERS_FILE):
        self.users_file = users_file
        self._load_users()

    def _get_default_users(self) -> Dict[str, Any]:
        return {
            "users": [
                {
                    "username": "admin",
                    "password_hash": generate_password_hash("admin"),
                    "role": "admin",
                    "created_at": time.strftime("%Y-%m-%d %H:%M:%S")
                }
            ]
        }

    def _load_users(self) -> None:
        if os.path.exists(self.users_file):
            try:
                with open(self.users_file, "r", encoding="utf-8") as f:
                    self.data = json.load(f)
                    return
            except Exception as e:
                logger.error(f"Erro ao ler {self.users_file}: {e}")
        self.data = self._get_default_users()
        self._save_users()

    def _save_users(self) -> None:
        try:
            with open(self.users_file, "w", encoding="utf-8") as f:
                json.dump(self.data, f, indent=2, ensure_ascii=False)
        except Exception as e:
            logger.error(f"Erro ao gravar {self.users_file}: {e}")

    def authenticate(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        username = username.strip().lower()
        for u in self.data.get("users", []):
            if u["username"].lower() == username:
                if check_password_hash(u["password_hash"], password):
                    return {
                        "username": u["username"],
                        "role": u.get("role", "admin")
                    }
        return None

    def change_password(self, username: str, old_pass: str, new_pass: str) -> Dict[str, Any]:
        username = username.strip().lower()
        for u in self.data.get("users", []):
            if u["username"].lower() == username:
                if not check_password_hash(u["password_hash"], old_pass):
                    return {"success": False, "message": "Senha atual incorreta."}
                if len(new_pass) < 4:
                    return {"success": False, "message": "A nova senha deve ter pelo menos 4 caracteres."}
                
                u["password_hash"] = generate_password_hash(new_pass)
                u["updated_at"] = time.strftime("%Y-%m-%d %H:%M:%S")
                self._save_users()
                return {"success": True, "message": "Senha alterada com sucesso!"}
        return {"success": False, "message": "Utilizador não encontrado."}

    def get_users_list(self) -> List[Dict[str, Any]]:
        return [
            {
                "username": u["username"],
                "role": u.get("role", "admin"),
                "created_at": u.get("created_at", "")
            }
            for u in self.data.get("users", [])
        ]
