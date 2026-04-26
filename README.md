# WETO-WARDRIVING

> Autonomous Wi-Fi wardriving ecosystem with GPS geolocation, MariaDB persistence, reverse geolocation, and a mobile-first web dashboard.

**Author:** Álvaro Rubio Adán · [github.com/weto91](https://github.com/weto91) · Madrid, ES  
**License:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

---

## Table of Contents

1. [Hardware Requirements](#1-hardware-requirements)
2. [System Packages](#2-system-packages)
3. [System User & Permissions](#3-system-user--permissions)
4. [MariaDB Setup](#4-mariadb-setup)
5. [GPS Setup (gpsd)](#5-gps-setup-gpsd)
6. [Wi-Fi Interface for Monitor Mode](#6-wi-fi-interface-for-monitor-mode)
7. [Apache & PHP](#7-apache--php)
8. [Web Files Deployment](#8-web-files-deployment)
9. [Python Environment (localization.py)](#9-python-environment-localizationpy)
10. [Sudoers Configuration](#10-sudoers-configuration)
11. [Systemd Services](#11-systemd-services)
12. [System Verification](#12-system-verification)
13. [File Reference](#13-file-reference)
14. [Generating localization.sqlite](#14-generating-localizationsqlite)

---

## 1. Hardware Requirements

| Component | Specification |
|-----------|--------------|
| **SBC** | Raspberry Pi Zero 2 W (or any Raspberry Pi with USB OTG; the smaller the better for portability) |
| **Wi-Fi adapter** | USB dongle with **MTK7601** chipset (any other chipset works, but **monitor mode** support is mandatory) |
| **GPS receiver** | Serial GPS module (e.g. **u-blox M8L**) connected to `/dev/ttyAMA0` |
| **Power** | 3× 4000 mAh Li-Po batteries in parallel via TC4056A module (tested: ~35–38 h of autonomy) |
| **Storage** | MicroSD ≥ 8 GB (Class 10 recommended) |

> **Important note:** The external USB dongle must support **monitor mode**. The Raspberry Pi's internal Wi-Fi chip (`wlan0`) is used to access the collected data through the web interface, either in managed or AP mode. The external dongle will appear as `wlan1` and will be used in monitor mode to capture Wi-Fi nodes and their information.

---

## 2. System Packages

Update the system and install all required dependencies:

```bash
sudo apt update && sudo apt upgrade -y

sudo apt install -y \
    mariadb-server \
    apache2 \
    php \
    php-pdo \
    php-mysql \
    tshark \
    gpsd \
    gpsd-clients \
    python3 \
    python3-pip \
    python3-venv \
    iw \
    wireless-tools \
    network-manager \
    sqlite3 \
    libsqlite3-dev \
    curl \
    jq
```

### Allow tshark to capture without root

During the `tshark` installation you will be asked whether non-superusers should be able to capture packets. Select **Yes**. If you missed it, run it manually:

```bash
sudo dpkg-reconfigure wireshark-common
sudo usermod -aG wireshark pi
```

---

## 3. System User & Permissions

The project assumes the default Raspberry Pi OS user `pi`. The web server runs as `www-data`.

```bash
# Add pi to the required groups
sudo usermod -aG wireshark pi   # packet capture with tshark
sudo usermod -aG dialout pi     # access to /dev/ttyAMA0 (GPS)
sudo usermod -aG www-data pi    # shared web file access (optional)
```

> Log out and back in, or reboot, for the group changes to take effect.

---

## 4. MariaDB Setup

### 4.1 Secure the installation

```bash
sudo mysql_secure_installation
# Follow the prompts:
#   - Set the root password
#   - Remove anonymous users
#   - Disallow remote root login
#   - Remove the test database
```

### 4.2 Create the database, user and tables

```bash
sudo mysql -u root -p
```

```sql
-- Create the database
CREATE DATABASE weto_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Create the application user
-- Credentials used across all scripts are: weto / weto12345
-- Change them if desired (see note below)
CREATE USER 'weto'@'localhost' IDENTIFIED BY 'weto12345';
GRANT ALL PRIVILEGES ON weto_db.* TO 'weto'@'localhost';
FLUSH PRIVILEGES;

USE weto_db;

-- Main captured Wi-Fi networks table
CREATE TABLE wifi_networks (
    bssid       VARCHAR(17)  NOT NULL,
    ssid        VARCHAR(255) DEFAULT '',
    vendor      VARCHAR(128) DEFAULT '',
    rssi        INT          DEFAULT 0,
    security    VARCHAR(64)  DEFAULT '',
    crypto      VARCHAR(64)  DEFAULT '',
    channel     INT          DEFAULT 0,
    lat         DOUBLE       DEFAULT NULL,
    lon         DOUBLE       DEFAULT NULL,
    calle       VARCHAR(255) DEFAULT NULL,
    ciudad      VARCHAR(128) DEFAULT NULL,
    last_seen   DATETIME     DEFAULT NOW(),
    PRIMARY KEY (bssid)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- MAC vendor OUI cache table
CREATE TABLE mac_cache (
    oui         VARCHAR(8)   NOT NULL,
    vendor      VARCHAR(128) DEFAULT '',
    PRIMARY KEY (oui)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

EXIT;
```

> **Credentials note:** The user `weto` with password `weto12345` is referenced in `get_data.php`, `status_api.php` and `localization.py`. If you use different credentials, update them consistently across those three files.

### 4.3 Populate the MAC vendor table (recommended)

Download the OUI list and import it into `mac_cache` so that vendor lookups work in `wardriving.sh`:

```bash
curl -s https://maclookup.app/downloads/json-database/get-db \
  | python3 -c "
import sys, json
data = json.load(sys.stdin)
for e in data:
    oui = e.get('macPrefix','').replace(':','').upper()[:6]
    vendor = e.get('vendorName','').replace(\"'\",\"''\")[:128]
    if oui:
        print(f\"INSERT IGNORE INTO mac_cache (oui,vendor) VALUES ('{oui}','{vendor}');\")
" | sudo mysql -u root -p weto_db
```

---

## 5. GPS Setup (gpsd)

### 5.1 Enable UART on the Raspberry Pi

Edit `/boot/config.txt` (or `/boot/firmware/config.txt` on newer OS versions):

```ini
enable_uart=1
dtoverlay=disable-bt        # frees ttyAMA0 from Bluetooth
```

Edit `/boot/cmdline.txt` and remove any reference to `console=serial0` or `console=ttyAMA0`:

```
# Remove this part if present: console=serial0,115200
```

Reboot to apply the changes:

```bash
sudo reboot
```

### 5.2 Configure gpsd

Edit `/etc/default/gpsd`:

```ini
START_DAEMON="true"
USBAUTO="false"
DEVICES="/dev/ttyAMA0"
GPSD_OPTIONS="-n -b"
GPSD_SOCKET="/var/run/gpsd.sock"
```

Enable and start the service:

```bash
sudo systemctl enable gpsd
sudo systemctl start gpsd
```

### 5.3 Verify GPS signal

```bash
gpspipe -w -n 10
```

`TPV` objects show the signal status via the `mode` field:

| Value | Meaning |
|-------|---------|
| `1` | No fix — possibly indoors or no satellite visibility |
| `2` | 2D fix — horizontal position available |
| `3` | 3D fix — full position with altitude |

### 5.4 GPS monitoring service via ACT LED (gpscheck)

The `gpscheck` service runs the script `/usr/local/bin/gpscheck.sh`, which continuously checks the GPS mode and reflects the status using the Raspberry Pi's ACT LED:

| GPS State | LED Behaviour |
|-----------|--------------|
| Mode 3 — 3D fix | LED solid on |
| Mode 2 — 2D fix | Very fast blink |
| Mode 1 — no fix | Slow blink (once per second) |
| Error / no communication | LED off |

The `gpscheck.service` file is located under `etc/systemd/system/` in the repository. Move it to its destination and enable it along with the rest of the services in [Step 11](#11-systemd-services).

---

## 6. Wi-Fi Interface for Monitor Mode

The external USB dongle (`wlan1`) is placed in **monitor mode** automatically by `wardriving.sh` at startup — no manual pre-configuration is required. Confirm the interface name:

```bash
ip link show
# Look for wlan1 (the external USB dongle)
```

If the interface name differs from `wlan1`, update the reference inside `wardriving.sh`.

Make sure NetworkManager does **not manage** `wlan1` (it must remain unmanaged for monitor mode to work correctly):

```bash
sudo nmcli device set wlan1 managed no
```

To make this persistent across reboots, create `/etc/NetworkManager/conf.d/unmanaged.conf`:

```ini
[keyfile]
unmanaged-devices=interface-name:wlan1
```

---

## 7. Apache & PHP

### 7.1 Enable the required PHP extensions

```bash
sudo apt install -y php-mysql php-pdo
sudo phpenmod pdo_mysql
```

### 7.2 Enable Apache

The web root is `/var/www/html`. Confirm Apache is running:

```bash
sudo systemctl enable apache2
sudo systemctl start apache2
```

### 7.3 Shell permissions for www-data

The PHP scripts use `shell_exec()` to invoke `gpspipe`, `systemctl`, `nmcli`, `iw`, etc. This requires the sudoers entry described in [Step 10](#10-sudoers-configuration).

---

## 8. Web Files Deployment

Copy the web files from the repository to the Apache root:

```bash
sudo cp -r /weto-wardriving/var/www/html/* /var/www/html/

# Set correct ownership and permissions
sudo chown -R www-data:www-data /var/www/html/
sudo chmod -R 755 /var/www/html/
```

Expected directory layout under `/var/www/html/`:

```
/var/www/html/
├── index.html
├── map.html
├── graficos.html
├── about.html
├── status.html
├── setup.html
├── get_data.php
├── status_api.php
├── setup_api.php
├── css/
│   ├── common.css
│   ├── about.css
│   ├── map.css
│   ├── setup.css
│   ├── stats.css
│   ├── status.css
│   └── table.css
├── js/
│   ├── about.js
│   ├── map.js
│   ├── setup.js
│   ├── stats.js
│   ├── status.js
│   ├── table.js
│   └── year.js
└── lib/
    ├── chart.min.js
    ├── jquery-3.7.0.min.js
    ├── jquery.dataTables.min.js
    ├── jquery.dataTables.min.css
    ├── leaflet.css
    ├── leaflet.js
    └── leaflet.markercluster.js
```

---

## 9. Python Environment (localization.py)

`localization.py` uses SpatiaLite to resolve GPS coordinates to street and city names from a local SQLite database (`localization.sqlite`).

### 9.1 Install dependencies

```bash
sudo apt install -y python3-pip libsqlite3-mod-spatialite

pip3 install --user \
    mysql-connector-python \
    pyspatialite
```

Or using a virtual environment:

```bash
python3 -m venv /home/pi/venv-weto
source /home/pi/venv-weto/bin/activate
pip install mysql-connector-python pyspatialite
```

### 9.2 Place the SpatiaLite database

The `localization.sqlite` file must be at the path referenced inside `localization.py`. Confirm or update the path in the script if needed. See [Step 14](#14-generating-localizationsqlite) for instructions on how to generate this database.

### 9.3 Run or schedule

Run manually:

```bash
python3 /opt/localization.py
```

Or schedule it with crontab (e.g. every 5 minutes):

```bash
crontab -e
# Add the following line:
*/5 * * * * /usr/bin/python3 /opt/localization.py >> /var/log/localization.log 2>&1
```

---

## 10. Sudoers Configuration

Create the sudoers drop-in file so that `www-data` (Apache/PHP) can run specific system commands without a password, and `pi` can launch `wardriving.sh` as root:

```bash
sudo visudo -f /etc/sudoers.d/weto-setup
```

Add the following content:

```
# WETO-WARDRIVING — www-data sudo permissions (no password)
www-data ALL=(ALL) NOPASSWD: \
    /usr/bin/nmcli, \
    /usr/bin/vcgencmd, \
    /usr/sbin/iw, \
    /usr/bin/iw, \
    /sbin/ip, \
    /sbin/reboot, \
    /sbin/poweroff, \
    /bin/systemctl restart *

# Allow pi to run the wardriving script as root
pi ALL=(ALL) NOPASSWD: /usr/local/bin/wardriving.sh
```

Set the correct permissions on the file:

```bash
sudo chmod 440 /etc/sudoers.d/weto-setup
```

---

## 11. Systemd Services

### 11.1 Install the service files

The repository includes ready-to-use `.service` files under `etc/systemd/system/`. Copy them to their destination:

```bash
sudo cp /weto-wardriving/etc/systemd/system/wardriving.service /etc/systemd/system/
sudo cp /weto-wardriving/etc/systemd/system/gpscheck.service   /etc/systemd/system/
```

### 11.2 Enable and start all services

```bash
sudo systemctl daemon-reload

sudo systemctl enable mariadb
sudo systemctl enable gpsd
sudo systemctl enable gpscheck
sudo systemctl enable apache2
sudo systemctl enable wardriving

sudo systemctl start mariadb
sudo systemctl start gpsd
sudo systemctl start gpscheck
sudo systemctl start apache2
sudo systemctl start wardriving
```

---

## 12. System Verification

Check that all components are active and working correctly:

```bash
# Status of all relevant services
sudo systemctl status wardriving gpsd gpscheck apache2 mariadb

# Verify the GPS is producing data
gpspipe -w -n 5

# Verify records in MariaDB
mysql -u weto -p'weto12345' weto_db -e "SELECT COUNT(*) FROM wifi_networks;"

# Verify Apache is serving the web interface
curl -s http://localhost/index.html | head -5

# Check wlan1 is in monitor mode (while wardriving.sh is running)
iw dev wlan1 info | grep type

# Verify tshark is capturing
pgrep -a tshark
```

Access the web dashboard from any device on the same network:

```
http://<raspberry-pi-ip>/
```

If the Raspberry Pi is in AP mode:

```
http://10.0.0.1/
```

---

## 13. File Reference

| File | Location | Purpose |
|------|----------|---------|
| `wardriving.sh` | `/usr/local/bin/wardriving.sh` | Main script: GPS, monitor mode scan, MariaDB insertion |
| `localization.py` | `/opt/localization.py` | Reverse geolocation: coordinates → street + city |
| `localization.sqlite` | `/opt/localization.sqlite` | SpatiaLite database of streets and cities |
| `gpscheck.sh` | `/usr/local/bin/gpscheck.sh` | Monitoring script: reflects GPS status on the ACT LED |
| `wardriving.service` | `/etc/systemd/system/wardriving.service` | Systemd service for the main script |
| `gpscheck.service` | `/etc/systemd/system/gpscheck.service` | Systemd service for GPS monitoring |
| `get_data.php` | `/var/www/html/get_data.php` | API: returns paginated Wi-Fi data as JSON |
| `status_api.php` | `/var/www/html/status_api.php` | API: real-time system metrics |
| `setup_api.php` | `/var/www/html/setup_api.php` | API: network config, service control, power management |
| `index.html` | `/var/www/html/index.html` | Web: searchable network list |
| `map.html` | `/var/www/html/map.html` | Web: interactive geolocation map |
| `graficos.html` | `/var/www/html/graficos.html` | Web: statistics and charts |
| `status.html` | `/var/www/html/status.html` | Web: live system monitoring dashboard |
| `about.html` | `/var/www/html/about.html` | Web: project and author information |
| `setup.html` | `/var/www/html/setup.html` | Web: remote setup panel |

---

## 14. Generating localization.sqlite

The `localization.sqlite` database contains the geospatial street and city data required for reverse geolocation. It is recommended to generate it on a PC with more resources before transferring it to the Raspberry Pi.

Run the `localization_sqlite_generator.sh` script included in the repository. The script will ask for the continent and country you want to generate, then automatically build the SQLite file with the complete list of worldwide cities and the streets of the selected country.

### Generator PC requirements

**Linux:**

```bash
sudo apt-get install -y wget unzip gdal-bin sqlite3 libsqlite3-mod-spatialite
```

**Windows (PowerShell):**

```powershell
# Install dependencies
winget install OSGeo.GDAL
winget install SQLite.SQLite

# Add GDAL to PATH for the current session
$env:PATH += ";C:\Program Files\GDAL"
# Or permanently: System > Environment Variables > Path > New

# Allow script execution
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

> **Prerequisites:** an active internet connection and enough RAM to handle the full database download and processing. A mid-sized country typically requires around **1 GB of RAM** during the process. Generation time varies from a few minutes to longer, depending on the country and the hardware of the PC.

Once generated, transfer the file to the Raspberry Pi:

```bash
scp localization.sqlite pi@<raspberry-ip>:/opt/localization.sqlite
```

---

## License

Copyright © 2026 Álvaro Rubio Adán. Licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
