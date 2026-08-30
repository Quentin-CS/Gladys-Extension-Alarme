# Gladys Zigbee Alarme

Intégration externe locale pour Gladys Assistant V5, pilotant un système d’alarme à partir des équipements Zigbee2MQTT existants. La première cible matérielle est le clavier Develco/Frient KEYZB-110.

Le projet est en développement local : aucune image ni entrée de catalogue n’est publiée.

## Démarrage développeur

Prérequis : Node.js 20+ (22 recommandé), Docker et un broker MQTT joignable.

```sh
npm install --install-strategy=shallow
npm test
npm run lint
docker build -t gladys-zigbee-alarme:0.1.0 .
docker build -f companion/Dockerfile -t gladys-zigbee-alarme-admin:0.1.0 .
```

Le manifeste [gladys-assistant-integration.json](gladys-assistant-integration.json) déclare l’intégration `device`, les secrets MQTT, les actions de diagnostic/réinitialisation et le port web local nommé `alarm_admin`.

Documentation : [français](docs/fr.md) · [English](docs/en.md) · [tests matériels](docs/hardware-validation.md).

Licence Apache-2.0.
