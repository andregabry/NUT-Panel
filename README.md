# ⚡ NUT Panel - UPS Management & Automation System

<div align="center">
  <h3><strong>Modern, Real-Time UPS Monitoring, Infrastructure Automation & Multi-Channel Alert Gateway</strong></h3>
  <p><em>Built on <strong>Network UPS Tools (NUT)</strong> • Real-Time SSE Synoptic Power Flow • Proxmox VE (SSH CLI) & VMware ESXi Graceful Shutdown • WhatsApp (Baileys MD), Microsoft Teams, Google Chat, SMS & SMTP Alerts</em></p>
</div>

---

## 📋 Table of Contents

1. [Overview](#-overview)
2. [Architecture](#-architecture)
3. [Key Features](#-key-features)
   - [Real-Time Synoptic Power Flow Diagram](#1-real-time-synoptic-power-flow-diagram)
   - [Infrastructure Shutdown Orchestration](#2-infrastructure-shutdown-orchestration)
   - [Multi-Channel Notification Gateways](#3-multi-channel-notification-gateways)
   - [Built-In REST API v1](#4-built-in-rest-api-v1)
4. [Modules & Microservices](#-modules--microservices)
5. [Installation & Deployment](#-installation--deployment)
   - [System Prerequisites](#system-prerequisites)
   - [Web Application Setup (Python/Flask)](#web-application-setup-pythonflask)
   - [WhatsApp Microservice Setup (Baileys MD)](#whatsapp-microservice-setup-baileys-md)
   - [Systemd Services Configuration](#systemd-services-configuration)
6. [Network & Static Routing Configuration](#-network--static-routing-configuration)
7. [REST API Reference](#-rest-api-reference)
8. [Project Structure](#-project-structure)
9. [License](#-license)

---

## 🌟 Overview

**NUT Panel** is an open-source, full-stack enterprise web dashboard and automation orchestrator for Uninterruptible Power Supplies (UPS / No-Break).

It interfaces natively with **Network UPS Tools (`upsd`)** over TCP socket protocol (`port 3493`), capturing live telemetry, evaluating complex threshold rules, executing staged graceful shutdowns of virtualized hypervisors (Proxmox VE via native SSH CLI and VMware ESXi), and delivering real-time actionable notifications across all major corporate messaging platforms.

---

## 🏗 Architecture

```
                      +------------------------------------------+
                      |         Industrial / Commercial UPS      |
                      |   (Modbus, USB, SNMP or Serial Interface)|
                      +--------------------+---------------------+
                                           |
                                      [/dev/ups]
                                           |
                      +--------------------+---------------------+
                      |       NUT Daemon (upsd / port 3493)      |
                      +--------------------+---------------------+
                                           |
                      +--------------------+---------------------+
                      |       NUT Panel Core Engine (Flask)      |
                      |     - Server-Sent Events (SSE Stream)    |
                      |     - Alert Rules & Deduplication Engine |
                      |     - Staged Shutdown Orchestrator (SSH) |
                      |     - REST API v1 (Bearer Token Auth)    |
                      +----------+-------------------+-----------+
                                 |                   |
            +--------------------+---+           +---+--------------------+
            | WhatsApp Microservice  |           | Multi-Channel Gateways |
            | (Node.js / Baileys MD) |           | - Microsoft Teams Card |
            |      [Port 3001]       |           | - Google Chat CardsV2  |
            +------------------------+           | - Custom Webhooks/SIEM |
                                                 | - SMS Gateway API      |
                                                 | - SMTP (Email Alerts)  |
                                                 +------------------------+
                                 |
            +--------------------+-------------------+
            | Managed Infrastructure (Graceful Auto) |
            | - Proxmox VE Nodes (Native SSH CLI)    |
            | - VMware ESXi Hypervisors (CLI / API)  |
            +----------------------------------------+
```

---

## 🚀 Key Features

### 1. Real-Time Synoptic Power Flow Diagram
- **Dynamic Energy Topology**: Live animated electrical schematic indicating:
  - **Mains AC Input**: Voltage (V), Current (A), Frequency (Hz), and Power Factor (PF).
  - **Rectifier / Battery Charger**: Charging and float status.
  - **DC Battery Bank**: Real-time Charge (%), DC Bus Voltage (V), and discharge currents.
  - **Inverter & Static Bypass**: Seamless mode visualization (Online Double-Conversion vs. Bypass).
  - **AC Output Load**: Active Power (W), Apparent Power (VA), and Load Percentage (%).
- **Server-Sent Events (SSE)**: Zero-lag sub-second updates without browser polling.

### 2. Infrastructure Shutdown Orchestration
- **Dual Trigger Modes**:
  - **Automated Mode**: Condition-based triggers (e.g., Battery Charge $\le 20\%$ or Mains outage $> 300$s).
  - **Manual Emergency Mode**: Controlled execution directly from the dashboard.
- **Proxmox VE via Native SSH CLI**:
  - Direct connection over SSH (Port 22, Password or RSA/Ed25519 Private Key).
  - Automatic inventory detection for Virtual Machines (`qm list`) and LXC Containers (`pct list`).
  - Three-stage sequenced shutdown (Stage 1: Non-critical VMs $\rightarrow$ Stage 2: Databases & critical workloads $\rightarrow$ Stage 3: Proxmox Host `shutdown -h now`).
- **VMware ESXi Support**:
  - Guest VM graceful shutdown via `esxcli` / API.

### 3. Multi-Channel Notification Gateways
- **WhatsApp Multi-Device (Baileys Node.js Microservice)**:
  - Independent daemon with QR Code pairing, multi-session state persistence, live chat modal, and real-time interactive simulator.
  - Dynamic template variables (`{rule_name}`, `{battery_charge}`, `{input_voltage}`, `{output_load}`, `{now}`).
- **Microsoft Teams (Adaptive Cards 1.4 & Webhooks)**:
  - Rich structured cards with severity-based theme accents (Critical / Warning / Normal) and metric grids.
  - Built-in deduplication filter preventing duplicate messages.
- **Google Chat (CardsV2)**:
  - Google Workspace Space webhooks in interactive CardsV2 layout with action buttons.
- **Generic Webhooks & SIEM**:
  - Configurable JSON payloads and HTTP authentication headers (`Bearer`, `Basic`, `ApiKey`).
- **SMS Gateway**:
  - HTTP GET/POST interface compatible with GSM gateways and cellular routers.
- **SMTP Email**:
  - Modern TLS/SSL email delivery compatible with Microsoft 365, Google Workspace, and internal mail relays.

### 4. Built-In REST API v1
- Secured via **Bearer Tokens** (`Bearer nut_live_...`).
- Granular permission scopes (`read`, `write`, `admin`).
- Ideal for integration with Grafana, Zabbix, Home Assistant, and Prometheus exporters.

---

## 📦 Modules & Microservices

| File / Directory | Description |
| :--- | :--- |
| `app.py` | Flask core application, routing, SSE streaming, and API endpoints. |
| `nut_client.py` | Low-level TCP socket client for the NUT `upsd` protocol. |
| `shutdown_manager.py` | Staged shutdown engine with Proxmox SSH execution and progress tracking. |
| `connections_manager.py`| Connection settings for NUT, Proxmox SSH, VMware, and API keys. |
| `alert_manager.py` | Rules evaluation engine, event cooldowns, and notification dispatchers. |
| `auth_manager.py` | Multi-user authentication, password hashing with salt, and session management. |
| `whatsapp_service/server.js` | Node.js WhatsApp Web microservice using `@whiskeysockets/baileys`. |
| `static/` & `templates/` | Pure light-theme UI, Tailwind CSS, Chart.js, and Lucide Icons. |

---

## 🛠 Installation & Deployment

### System Prerequisites
- Linux OS (Ubuntu 22.04/24.04 LTS, Debian 12, or AlmaLinux/Rocky)
- Python 3.10+ with `pip` and `venv`
- Node.js 18+ and `npm`
- Running NUT server (`upsd`) with appropriate UPS driver configured

### Web Application Setup (Python/Flask)
```bash
# 1. Clone repository
git clone https://github.com/andregabry/NUT-Panel.git /opt/nut-panel
cd /opt/nut-panel

# 2. Setup Python Virtual Environment
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

### WhatsApp Microservice Setup (Baileys MD)
```bash
# 3. Install Node.js dependencies
cd /opt/nut-panel/whatsapp_service
npm install
```

### Systemd Services Configuration

#### 1. Core Web Dashboard (`/etc/systemd/system/nut-panel.service`)
```ini
[Unit]
Description=NUT Panel - Core Web Management Service
After=network.target nut-server.service

[Service]
Type=simple
User=root
WorkingDirectory=/opt/nut-panel
ExecStart=/opt/nut-panel/venv/bin/python app.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1
Environment=WEB_PORT=8080

[Install]
WantedBy=multi-user.target
```

#### 2. WhatsApp Microservice (`/etc/systemd/system/nut-whatsapp.service`)
```ini
[Unit]
Description=NUT Panel - WhatsApp Web Microservice (Baileys)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/nut-panel/whatsapp_service
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=PORT=3001

[Install]
WantedBy=multi-user.target
```

```bash
# Enable and start services
sudo systemctl daemon-reload
sudo systemctl enable --now nut-panel.service
sudo systemctl enable --now nut-whatsapp.service
```

Access the web interface at **`http://<SERVER_IP>:8080`** (Default user: `admin` / `admin`).

---

## 🌐 Network & Static Routing Configuration

When running NUT Panel on dedicated or isolated subnets (e.g. `10.255.255.0/24`) that need to reach hypervisors across other internal subnets (`192.168.4.0/23`, `192.168.10.0/23`), configure persistent routes in Netplan (`/etc/netplan/50-cloud-init.yaml`):

```yaml
network:
  version: 2
  renderer: networkd
  ethernets:
    ens192:
      dhcp4: false
      addresses:
        - 10.255.255.28/24
      routes:
        - to: default
          via: 10.255.255.254
          metric: 100
          on-link: true
        - to: 192.168.4.0/23
          via: 10.255.255.251
        - to: 192.168.10.0/23
          via: 10.255.255.251
      nameservers:
        addresses:
          - 1.1.1.1
          - 8.8.8.8
```

Apply network routes:
```bash
sudo netplan apply
```

---

## 📡 REST API Reference

All API requests require the standard HTTP authorization header:
```http
Authorization: Bearer <YOUR_API_TOKEN>
Content-Type: application/json
```

### Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/api/v1/ups/live` | Live UPS metrics, electrical telemetry, and active alarms. |
| `GET` | `/api/v1/ups/variables` | Full raw key-value parameter dump from the NUT driver. |
| `GET` | `/api/v1/shutdown/status` | Current contingency state and staged shutdown progress. |
| `POST`| `/api/v1/shutdown/execute` | Manually triggers an infrastructure shutdown plan. |
| `POST`| `/api/v1/shutdown/abort` | Immediately aborts a pending shutdown sequence. |
| `POST`| `/api/v1/alerts/test` | Triggers a test message on a specified channel. |
| `GET` | `/api/v1/connections/proxmox/test` | Tests SSH connectivity to configured Proxmox nodes. |

#### Sample Response (`GET /api/v1/ups/live`):
```json
{
  "success": true,
  "data": {
    "status": {
      "label": "ONLINE",
      "is_online": true,
      "on_battery": false,
      "low_battery": false,
      "raw_flags": "OL"
    },
    "battery": {
      "charge_pct": 100,
      "voltage": 218.4,
      "runtime_seconds": 3600
    },
    "input": {
      "voltage": 230.1,
      "frequency": 50.0
    },
    "output": {
      "voltage": 230.0,
      "load_pct": 18,
      "real_power_w": 1080,
      "apparent_power_va": 1150
    }
  }
}
```

---

## 🗂 Project Structure

```
NUT-Panel/
├── alert_manager.py             # Alert rules evaluation & notification dispatch
├── app.py                       # Main Flask web server & SSE controller
├── auth_manager.py              # User sessions & authentication management
├── config.py                    # Global application configuration
├── connections_manager.py       # NUT, Proxmox SSH, VMware & API token management
├── nut_client.py                # Network UPS Tools TCP client
├── shutdown_manager.py          # Staged graceful shutdown orchestrator
├── requirements.txt             # Python dependencies
├── static/
│   ├── css/
│   │   └── style.css            # Custom CSS & clean light theme
│   └── js/
│       └── app.js               # Reactive frontend logic, SSE & WebSocket
├── templates/
│   ├── index.html               # Main dashboard & management UI
│   └── login.html               # Login screen
└── whatsapp_service/
    ├── package.json             # Node.js dependencies
    └── server.js                # Baileys Multi-Device microservice
```

---

## 📄 License

This project is licensed under the MIT License.
