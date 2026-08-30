# User guide — Gladys Zigbee Alarm

## Local installation

Build both images locally with the README commands, then add the manifest as a development external integration in Gladys. Enter the MQTT broker host/port, topic prefix (`zigbee2mqtt` by default) and optional credentials. The MQTT password is a declared secret and is never logged.

“Test MQTT and scan” asks Zigbee2MQTT for its inventory. Create the discovered “Système d’alarme” device in Gladys. Requested mode can be controlled from dashboards, scenes and the API; actual state remains separate and read-only.

## Local administration

Open the “Alarm administration” link exposed by Gladys. On first start, use “Reset admin password” in Gladys, record the displayed temporary password, sign in and choose a unique password of at least 12 characters.

The UI is intentionally local-network only and uses HTTP. A party able to intercept local traffic may observe its contents, including the login password. Only use it on a trusted network and never expose the port to the Internet.

Sessions expire after one hour, use `HttpOnly`/`SameSite=Strict` cookies and CSRF protection. A password reset immediately invalidates every session.

## Gladys notifications

The virtual device’s `notification-event` feature changes for intrusion, tamper, panic, duress, repeated invalid codes, low battery, offline equipment, and MQTT loss/restoration. Create a Gladys scene triggered by this feature and add the desired Gladys Plus and Telegram actions. The scene only relays events; alarm logic remains inside the integration.

## Security and backups

Four-to-eight-digit PINs are derived with scrypt, unique salts and optional internal `ALARM_PEPPER`. Backups use AES-256-GCM with a key derived using scrypt from a passphrase of at least 12 characters. They contain PIN verifiers but never plaintext PINs, and exclude MQTT credentials.

Store the passphrase outside Gladys. On another installation provide the same `ALARM_PEPPER` and re-enter MQTT credentials.
