# Guide utilisateur — Gladys Zigbee Alarme

## Installation locale

Construisez les deux images localement avec les commandes du README, puis ajoutez le manifeste comme intégration externe de développement dans Gladys. Renseignez l’hôte et le port du broker MQTT, le préfixe (`zigbee2mqtt` par défaut) et, si nécessaire, les identifiants. Le mot de passe MQTT est déclaré secret et n’est jamais journalisé.

L’action « Tester MQTT et découvrir » demande à Zigbee2MQTT son inventaire. Créez ensuite l’appareil découvert « Système d’alarme » dans Gladys. Son mode demandé est pilotable depuis le tableau de bord, les scènes et l’API ; son état réel reste distinct et en lecture seule.

## Administration locale

Ouvrez le lien « Administration de l’alarme » fourni par Gladys. Au premier démarrage, utilisez l’action Gladys « Réinitialiser le mot de passe administrateur », notez le mot de passe temporaire affiché, connectez-vous puis choisissez un mot de passe unique d’au moins 12 caractères.

L’interface est volontairement limitée au réseau local. Elle utilise HTTP : le contenu, y compris le mot de passe lors de la connexion, peut être observé par une personne capable d’intercepter le trafic local. Utilisez uniquement un réseau de confiance et n’exposez jamais ce port à Internet.

Les sessions expirent après une heure, utilisent des cookies `HttpOnly`/`SameSite=Strict` et une protection CSRF. Une réinitialisation invalide immédiatement toutes les sessions.

## Notifications Gladys

La fonction `notification-event` de l’appareil virtuel émet une nouvelle valeur pour intrusion, sabotage, panique, contrainte, codes invalides répétés, batterie faible, équipement hors ligne et perte/retour MQTT. Créez une scène Gladys déclenchée sur cette fonction et ajoutez-y les actions Gladys Plus et Telegram souhaitées. La scène relaie uniquement l’événement ; elle ne porte aucune logique d’alarme.

## Sécurité et sauvegardes

Les PIN de 4 à 8 chiffres sont dérivés avec scrypt, sel unique et secret interne optionnel `ALARM_PEPPER`. Les sauvegardes sont chiffrées par AES-256-GCM avec une clé dérivée par scrypt d’une phrase secrète d’au moins 12 caractères. Elles contiennent les vérificateurs des PIN, jamais les PIN en clair, et excluent les identifiants MQTT.

Conservez la phrase secrète hors de Gladys. Après restauration sur une nouvelle installation, fournissez le même `ALARM_PEPPER` et ressaisissez les identifiants MQTT.
