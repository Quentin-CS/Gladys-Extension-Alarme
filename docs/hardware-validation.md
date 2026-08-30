# Matrice de validation matérielle V1

À compléter sur l’instance physique avant de déclarer la V1 acceptée.

| Test                                                   | Matériel/version               | Résultat | Preuve/date |
| ------------------------------------------------------ | ------------------------------ | -------- | ----------- |
| Armement/désarmement et transaction IAS ACE            | KEYZB-110 FW 2.0.6, Z2M 2.13.0 | À faire  |             |
| Voyants et retours sonores entrée/sortie/erreur/alarme | KEYZB-110 FW 2.0.6             | À faire  |             |
| Contact ouvert et contournement/refus                  | Détecteur d’ouverture réel     | À faire  |             |
| Intrusion et relance des sirènes                       | Mouvement + sirène réelle      | À faire  |             |
| Sabotage désarmé                                       | Équipement avec `tamper`       | À faire  |             |
| Panique sonore et silencieuse                          | KEYZB-110 + sirène             | À faire  |             |
| Perte et retour MQTT en étant armé                     | Mosquitto/Z2M                  | À faire  |             |
| Redémarrage pendant délai et état armé                 | Gladys 5.0.1                   | À faire  |             |
| Relais Gladys Plus et Telegram par scène               | Canaux de test configurés      | À faire  |             |
| Image principale et compagnon                          | linux/amd64                    | À faire  |             |
| Image principale et compagnon                          | linux/arm64                    | À faire  |             |

Pour chaque ligne, joindre les sujets MQTT capturés en masquant `action_code`, les valeurs Gladys observées et le résultat attendu/réel. Aucun PIN ni mot de passe ne doit apparaître dans les preuves.
