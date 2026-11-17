import os
import time
import logging
from typing import Dict, Any, List, Optional
from werkzeug.security import generate_password_hash, check_password_hash
from db import db

logger = logging.getLogger(__name__)

class AuthManager:
    def __init__(self):
        # Garante utilizador admin default se base de dados estiver vazia
        users = db.get_users()
        if not users:
            db.save_user("admin", generate_password_hash("admin"), "admin")

    def authenticate(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        u = db.get_user(username)
        if u and check_password_hash(u["password_hash"], password):
            return {
                "username": u["username"],
                "role": u.get("role", "admin")
            }
        return None

    def change_password(self, username: str, old_pass: str, new_pass: str) -> Dict[str, Any]:
        u = db.get_user(username)
        if not u:
            return {"success": False, "message": "Utilizador não encontrado."}
        if not check_password_hash(u["password_hash"], old_pass):
            return {"success": False, "message": "Senha atual incorreta."}
        if len(new_pass) < 4:
            return {"success": False, "message": "A nova senha deve ter pelo menos 4 caracteres."}
        
        new_hash = generate_password_hash(new_pass)
        db.update_password(username, new_hash)
        return {"success": True, "message": "Senha alterada com sucesso!"}

    def get_users_list(self) -> List[Dict[str, Any]]:
        return [
            {
                "username": u["username"],
                "role": u.get("role", "admin"),
                "created_at": u.get("created_at", "")
            }
            for u in db.get_users()
        ]
