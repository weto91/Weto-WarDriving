# WETO-WARDRIVING

> Ecosistema autónomo de wardriving Wi-Fi con geolocalización GPS, persistencia en MariaDB, geocodificación inversa y panel web optimizado para móvil.

**Autor:** Álvaro Rubio Adán · [github.com/weto91](https://github.com/weto91) · Madrid, ES  
**Licencia:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

---

## Índice

1. [Requisitos de hardware](#1-requisitos-de-hardware)
2. [Paquetes del sistema](#2-paquetes-del-sistema)
3. [Usuario del sistema y permisos](#3-usuario-del-sistema-y-permisos)
4. [Configuración de MariaDB](#4-configuración-de-mariadb)
5. [Configuración del GPS (gpsd)](#5-configuración-del-gps-gpsd)
6. [Interfaz Wi-Fi para monitor mode](#6-interfaz-wi-fi-para-monitor-mode)
7. [Apache y PHP](#7-apache-y-php)
8. [Despliegue de los ficheros web](#8-despliegue-de-los-ficheros-web)
9. [Entorno Python (localization.py)](#9-entorno-python-localizationpy)
10. [Configuración de sudoers](#10-configuración-de-sudoers)
11. [Servicios systemd](#11-servicios-systemd)
12. [Verificación del sistema](#12-verificación-del-sistema)
13. [Referencia de ficheros](#13-referencia-de-ficheros)
14. [Generación de localization.sqlite](#14-generación-de-localizationsqlite)

---

## 1. Requisitos de hardware

| Componente | Especificación |
|------------|---------------|
| **SBC** | Raspberry Pi Zero 2 W (o cualquier Raspberry Pi con USB OTG; cuanto más pequeña, más portable) |
| **Adaptador Wi-Fi** | Dongle USB con chipset **MTK7601** (puede ser cualquier otro, pero es imprescindible que soporte **monitor mode**) |
| **Receptor GPS** | Módulo GPS serie (p. ej. **u-blox M8L**) conectado a `/dev/ttyAMA0` |
| **Alimentación** | 3× baterías Li-Po 4000 mAh en paralelo vía módulo TC4056A (probado: ~35–38 h de autonomía) |
| **Almacenamiento** | MicroSD ≥ 8 GB (Clase 10 recomendada) |

> **Nota importante:** El dongle USB externo debe soportar **monitor mode**. La tarjeta Wi-Fi interna de la Raspberry Pi (`wlan0`) se usa para el acceso a los datos recopilados a través del interfaz web, ya sea en modo managed o modo AP. El dongle externo aparecerá como `wlan1` y será usado en modo monitor para capturar nodos y su información.

---

## 2. Paquetes del sistema

Actualiza el sistema e instala todas las dependencias necesarias:

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

### Permitir que tshark capture sin root

Durante la instalación de `tshark` se preguntará si los usuarios sin privilegios pueden capturar paquetes. Selecciona **Sí**. Si lo omitiste, ejecútalo manualmente:

```bash
sudo dpkg-reconfigure wireshark-common
sudo usermod -aG wireshark pi
```

---

## 3. Usuario del sistema y permisos

El proyecto asume el usuario por defecto `pi` de Raspberry Pi OS. El servidor web se ejecuta como `www-data`.

```bash
# Añadir pi a los grupos necesarios
sudo usermod -aG wireshark pi   # captura de paquetes con tshark
sudo usermod -aG dialout pi     # acceso a /dev/ttyAMA0 (GPS)
sudo usermod -aG www-data pi    # acceso compartido a ficheros web (opcional)
```

> Cierra sesión y vuelve a entrar, o reinicia, para que los cambios de grupo surtan efecto.

---

## 4. Configuración de MariaDB

### 4.1 Asegurar la instalación

```bash
sudo mysql_secure_installation
# Sigue las instrucciones:
#   - Establece contraseña root
#   - Elimina usuarios anónimos
#   - Deshabilita acceso remoto root
#   - Elimina la base de datos de pruebas
```

### 4.2 Crear base de datos, usuario y tablas

```bash
sudo mysql -u root -p
```

```sql
-- Crear base de datos
CREATE DATABASE weto_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Crear usuario de la aplicación
-- Las credenciales usadas en los scripts son: weto / weto12345
-- Cámbialas si lo deseas (ver nota más abajo)
CREATE USER 'weto'@'localhost' IDENTIFIED BY 'weto12345';
GRANT ALL PRIVILEGES ON weto_db.* TO 'weto'@'localhost';
FLUSH PRIVILEGES;

USE weto_db;

-- Tabla principal de redes Wi-Fi capturadas
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

-- Tabla caché de fabricantes por OUI (MAC)
CREATE TABLE mac_cache (
    oui         VARCHAR(8)   NOT NULL,
    vendor      VARCHAR(128) DEFAULT '',
    PRIMARY KEY (oui)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

EXIT;
```

> **Nota sobre credenciales:** El usuario `weto` con contraseña `weto12345` está referenciado en `get_data.php`, `status_api.php` y `localization.py`. Si usas credenciales distintas, cámbialas de forma consistente en esos tres ficheros.

### 4.3 Poblar la tabla de fabricantes MAC (recomendado)

Descarga el listado OUI e impórtalo en `mac_cache` para que las búsquedas de fabricante funcionen en `wardriving.sh`:

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

## 5. Configuración del GPS (gpsd)

### 5.1 Habilitar UART en la Raspberry Pi

Edita `/boot/config.txt` (o `/boot/firmware/config.txt` en versiones más recientes del SO):

```ini
enable_uart=1
dtoverlay=disable-bt        # libera ttyAMA0 del Bluetooth
```

Edita `/boot/cmdline.txt` y elimina cualquier referencia a `console=serial0` o `console=ttyAMA0`:

```
# Elimina esta parte si existe: console=serial0,115200
```

Reinicia para aplicar los cambios:

```bash
sudo reboot
```

### 5.2 Configurar gpsd

Edita `/etc/default/gpsd`:

```ini
START_DAEMON="true"
USBAUTO="false"
DEVICES="/dev/ttyAMA0"
GPSD_OPTIONS="-n -b"
GPSD_SOCKET="/var/run/gpsd.sock"
```

Habilita e inicia el servicio:

```bash
sudo systemctl enable gpsd
sudo systemctl start gpsd
```

### 5.3 Verificar señal GPS

```bash
gpspipe -w -n 10
```

Los objetos `TPV` muestran el estado de la señal según el campo `mode`:

| Valor | Significado |
|-------|-------------|
| `1` | Sin fix — posiblemente bajo techo o sin visibilidad satelital |
| `2` | Fix 2D — posición horizontal disponible |
| `3` | Fix 3D — posición completa con altitud |

### 5.4 Servicio de monitorización GPS por LED ACT (gpscheck)

El servicio `gpscheck` ejecuta el script `/usr/local/bin/gpscheck.sh`, que comprueba continuamente el modo GPS y refleja el estado mediante el LED ACT de la Raspberry Pi:

| Estado GPS | Comportamiento del LED |
|------------|----------------------|
| Modo 3 — fix 3D | LED fijo encendido |
| Modo 2 — fix 2D | Parpadeo muy rápido |
| Modo 1 — sin fix | Parpadeo lento (cada segundo) |
| Error / sin comunicación | LED apagado |

El fichero de servicio `gpscheck.service` se encuentra en `etc/systemd/system/` dentro del repositorio. Muévelo a su destino y actívalo junto al resto de servicios en el [Paso 11](#11-servicios-systemd).

---

## 6. Interfaz Wi-Fi para monitor mode

El dongle USB externo (`wlan1`) es puesto en **monitor mode** automáticamente por `wardriving.sh` al arrancar — no requiere configuración manual previa. Confirma el nombre de la interfaz:

```bash
ip link show
# Busca wlan1 (el dongle USB externo)
```

Si el nombre de la interfaz difiere de `wlan1`, actualiza la referencia dentro de `wardriving.sh`.

Asegúrate de que NetworkManager **no gestione** `wlan1` (debe permanecer sin gestionar para que el monitor mode funcione correctamente):

```bash
sudo nmcli device set wlan1 managed no
```

Para hacerlo persistente entre reinicios, crea `/etc/NetworkManager/conf.d/unmanaged.conf`:

```ini
[keyfile]
unmanaged-devices=interface-name:wlan1
```

---

## 7. Apache y PHP

### 7.1 Habilitar las extensiones PHP necesarias

```bash
sudo apt install -y php-mysql php-pdo
sudo phpenmod pdo_mysql
```

### 7.2 Habilitar Apache

La raíz web es `/var/www/html`. Confirma que Apache está activo:

```bash
sudo systemctl enable apache2
sudo systemctl start apache2
```

### 7.3 Permisos de shell para www-data

Los scripts PHP usan `shell_exec()` para invocar `gpspipe`, `systemctl`, `nmcli`, `iw`, etc. Esto requiere la entrada de sudoers descrita en el [Paso 10](#10-configuración-de-sudoers).

---

## 8. Despliegue de los ficheros web

Copia los ficheros web del repositorio a la raíz de Apache:

```bash
sudo cp -r /weto-wardriving/var/www/html/* /var/www/html/

# Establece la propiedad y permisos correctos
sudo chown -R www-data:www-data /var/www/html/
sudo chmod -R 755 /var/www/html/
```

Estructura de directorios esperada bajo `/var/www/html/`:

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

## 9. Entorno Python (localization.py)

`localization.py` usa SpatiaLite para resolver coordenadas GPS en nombre de calle y ciudad a partir de una base de datos SQLite local (`localization.sqlite`).

### 9.1 Instalar dependencias

```bash
sudo apt install -y python3-pip libsqlite3-mod-spatialite

pip3 install --user \
    mysql-connector-python \
    pyspatialite
```

O usando un entorno virtual:

```bash
python3 -m venv /home/pi/venv-weto
source /home/pi/venv-weto/bin/activate
pip install mysql-connector-python pyspatialite
```

### 9.2 Colocar la base de datos SpatiaLite

El fichero `localization.sqlite` debe estar en la ruta referenciada dentro de `localization.py`. Confirma o actualiza la ruta en el script si es necesario. Consulta el [Paso 14](#14-generación-de-localizationsqlite) para saber cómo generar esta base de datos.

### 9.3 Ejecución o programación

Ejecución manual:

```bash
python3 /opt/localization.py
```

O programa su ejecución periódica mediante crontab (p. ej. cada 5 minutos):

```bash
crontab -e
# Añade la siguiente línea:
*/5 * * * * /usr/bin/python3 /opt/localization.py >> /var/log/localization.log 2>&1
```

---

## 10. Configuración de sudoers

Crea el fichero de sudoers para que `www-data` (Apache/PHP) pueda ejecutar comandos de sistema sin contraseña, y `pi` pueda lanzar `wardriving.sh` como root:

```bash
sudo visudo -f /etc/sudoers.d/weto-setup
```

Añade el siguiente contenido:

```
# WETO-WARDRIVING — permisos sudo para www-data (sin contraseña)
www-data ALL=(ALL) NOPASSWD: \
    /usr/bin/nmcli, \
    /usr/bin/vcgencmd, \
    /usr/sbin/iw, \
    /usr/bin/iw, \
    /sbin/ip, \
    /sbin/reboot, \
    /sbin/poweroff, \
    /bin/systemctl restart *

# Permitir a pi ejecutar el script de wardriving como root
pi ALL=(ALL) NOPASSWD: /usr/local/bin/wardriving.sh
```

Establece los permisos correctos sobre el fichero:

```bash
sudo chmod 440 /etc/sudoers.d/weto-setup
```

---

## 11. Servicios systemd

### 11.1 Instalar los ficheros de servicio

El repositorio incluye los ficheros `.service` listos para usar bajo `etc/systemd/system/`. Cópialos a su destino:

```bash
sudo cp /weto-wardriving/etc/systemd/system/wardriving.service /etc/systemd/system/
sudo cp /weto-wardriving/etc/systemd/system/gpscheck.service   /etc/systemd/system/
```

### 11.2 Habilitar e iniciar todos los servicios

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

## 12. Verificación del sistema

Comprueba que todos los componentes están activos y funcionando correctamente:

```bash
# Estado de todos los servicios relevantes
sudo systemctl status wardriving gpsd gpscheck apache2 mariadb

# Verificar que el GPS produce datos
gpspipe -w -n 5

# Verificar registros en MariaDB
mysql -u weto -p'weto12345' weto_db -e "SELECT COUNT(*) FROM wifi_networks;"

# Verificar que Apache sirve el interfaz web
curl -s http://localhost/index.html | head -5

# Comprobar que wlan1 está en modo monitor (con wardriving.sh en ejecución)
iw dev wlan1 info | grep type

# Verificar que tshark está capturando
pgrep -a tshark
```

Accede al panel web desde cualquier dispositivo en la misma red:

```
http://<ip-de-la-raspberry-pi>/
```

Si la Raspberry Pi está en modo AP:

```
http://10.0.0.1/
```

---

## 13. Referencia de ficheros

| Fichero | Ubicación | Función |
|---------|-----------|---------|
| `wardriving.sh` | `/usr/local/bin/wardriving.sh` | Script principal: GPS, escaneo en monitor mode, inserción en MariaDB |
| `localization.py` | `/opt/localization.py` | Geocodificación inversa: coordenadas → calle + ciudad |
| `localization.sqlite` | `/opt/localization.sqlite` | Base de datos SpatiaLite de calles y ciudades |
| `gpscheck.sh` | `/usr/local/bin/gpscheck.sh` | Script de monitorización: refleja el estado del GPS en el LED ACT |
| `wardriving.service` | `/etc/systemd/system/wardriving.service` | Servicio systemd para el script principal |
| `gpscheck.service` | `/etc/systemd/system/gpscheck.service` | Servicio systemd para la monitorización GPS |
| `get_data.php` | `/var/www/html/get_data.php` | API: devuelve datos Wi-Fi paginados en JSON |
| `status_api.php` | `/var/www/html/status_api.php` | API: métricas del sistema en tiempo real |
| `setup_api.php` | `/var/www/html/setup_api.php` | API: configuración de red, control de servicios y apagado |
| `index.html` | `/var/www/html/index.html` | Web: lista de redes con búsqueda |
| `map.html` | `/var/www/html/map.html` | Web: mapa interactivo con geolocalización |
| `graficos.html` | `/var/www/html/graficos.html` | Web: estadísticas y gráficas |
| `status.html` | `/var/www/html/status.html` | Web: panel de monitorización en vivo |
| `about.html` | `/var/www/html/about.html` | Web: información del proyecto y el autor |
| `setup.html` | `/var/www/html/setup.html` | Web: panel de configuración remota |

---

## 14. Generación de localization.sqlite

La base de datos `localization.sqlite` contiene la información geoespacial de calles y ciudades necesaria para la geocodificación inversa. Se recomienda generarla en un PC con más recursos antes de transferirla a la Raspberry Pi.

Ejecuta el script `localization_sqlite_generator.sh` incluido en el repositorio. El script pedirá el continente y el país que deseas generar, y construirá automáticamente el fichero SQLite con la lista completa de ciudades del mundo y las calles del país seleccionado.

### Requisitos del PC generador

**Linux:**

```bash
sudo apt-get install -y wget unzip gdal-bin sqlite3 libsqlite3-mod-spatialite
```

**Windows (PowerShell):**

```powershell
# Instalar dependencias
winget install OSGeo.GDAL
winget install SQLite.SQLite

# Añadir GDAL al PATH de la sesión actual
$env:PATH += ";C:\Program Files\GDAL"
# O de forma permanente: Sistema > Variables de entorno > Path > Nueva

# Permitir ejecución de scripts
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

> **Requisitos previos:** conexión a internet activa y memoria RAM suficiente para la descarga y procesado de los datos. Un país de tamaño intermedio puede requerir aproximadamente **1 GB de RAM** durante el proceso. La generación puede tardar varios minutos dependiendo del país y el hardware del PC.

Una vez generado, transfiere el fichero a la Raspberry Pi:

```bash
scp localization.sqlite pi@<ip-raspberry>:/opt/localization.sqlite
```

---

## Licencia

Copyright © 2026 Álvaro Rubio Adán. Licenciado bajo [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
