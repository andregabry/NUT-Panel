import os

class Config:
    NUT_HOST = os.getenv("NUT_HOST", "127.0.0.1")
    NUT_PORT = int(os.getenv("NUT_PORT", "3493"))
    NUT_UPS_NAME = os.getenv("NUT_UPS_NAME", "ups")
    NUT_USERNAME = os.getenv("NUT_USERNAME", "enging")
    NUT_PASSWORD = os.getenv("NUT_PASSWORD", "enging!pt")
    
    POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", "2.0"))
    MAX_HISTORY_POINTS = int(os.getenv("MAX_HISTORY_POINTS", "1800"))
    
    WEB_HOST = os.getenv("WEB_HOST", "127.0.0.1")
    WEB_PORT = int(os.getenv("WEB_PORT", "9000"))
    
    SECRET_KEY = os.getenv("SECRET_KEY", "nut_super_secret_session_key_2026_invt")
