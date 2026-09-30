import os

class Config:
    NUT_HOST = os.getenv("NUT_HOST", "127.0.0.1")
    NUT_PORT = int(os.getenv("NUT_PORT", 3493))
    NUT_UPS_NAME = os.getenv("NUT_UPS_NAME", "ups")
    NUT_USERNAME = os.getenv("NUT_USERNAME", "admin")
    NUT_PASSWORD = os.getenv("NUT_PASSWORD", "admin123")
    POLL_INTERVAL = float(os.getenv("POLL_INTERVAL", 2.0))
    WEB_HOST = os.getenv("WEB_HOST", "0.0.0.0")
    WEB_PORT = int(os.getenv("WEB_PORT", 8080))
    DEBUG = os.getenv("DEBUG", "False").lower() in ("true", "1", "t")
