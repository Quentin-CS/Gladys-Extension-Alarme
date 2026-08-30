# Cahier des charges — Gladys Zigbee Alarme

## 1. Objet du projet

Le projet **Gladys Zigbee Alarme** a pour objectif de fournir à Gladys Assistant V5 une véritable solution de pilotage d'alarme, comparable dans son principe à Alarmo pour Home Assistant, tout en restant impérativement une **intégration externe** conforme au dépôt officiel [`GladysAssistant/integration-template-js`](https://github.com/GladysAssistant/integration-template-js).

L'intégration doit exploiter les équipements déjà appairés au Zigbee2MQTT utilisé par Gladys, avec une première compatibilité matérielle ciblant le clavier **Develco KEYZB-110**, également commercialisé sous la marque Frient.

Le projet sera nommé **Gladys Zigbee Alarme** et conservera la licence **Apache-2.0** du template officiel.

## 2. Contexte technique de référence

- Gladys Assistant : **V5.0.1**.
- Zigbee2MQTT : **2.13.0**.
- Clavier initial : **KEYZB-110**.
- Firmware du clavier : **2.0.6**.
- Les détecteurs, claviers et sirènes sont gérés par le même Zigbee2MQTT.
- L'intégration doit fonctionner sur tous les systèmes supportés par Gladys, au minimum en images Docker `linux/amd64` et `linux/arm64`.
- Le projet reste local et non publié pendant la phase de développement.
- Une instance Gladys de test et des équipements Zigbee physiques seront disponibles pour les essais.

## 3. Contraintes structurantes

### 3.1 Intégration externe uniquement

Le projet ne doit demander aucune modification du cœur ou de l'interface native de Gladys. Il doit utiliser :

- le template JavaScript officiel ;
- le SDK officiel `@gladysassistant/integration-sdk` ;
- le mécanisme des appareils externes ;
- un conteneur compagnon déclaré dans le manifeste pour l'interface d'administration locale.

### 3.2 Accès aux équipements

Le SDK externe ne permettant pas de parcourir librement tous les appareils appartenant à d'autres intégrations Gladys, les équipements de sécurité doivent être découverts directement auprès de Zigbee2MQTT.

La configuration de l'intégration demandera donc :

- l'adresse du broker MQTT ;
- son port ;
- son préfixe de sujets, `zigbee2mqtt` par défaut ;
- un utilisateur ;
- un mot de passe stocké comme secret Gladys ;
- les éventuelles options de connexion nécessaires.

### 3.3 Interface dédiée

Le formulaire générique de Gladys ne suffit pas à administrer un nombre variable de zones, d'équipements et de codes. L'intégration fournira donc une interface web locale dédiée dans un conteneur compagnon supervisé par Gladys.

Cette interface :

- sera accessible depuis un lien dans la configuration de l'intégration ;
- sera responsive sur ordinateur, tablette et smartphone ;
- sera disponible en français et en anglais ;
- sera limitée au réseau local ;
- utilisera HTTP, sans HTTPS intégré ni reverse proxy obligatoire ;
- sera protégée par un mot de passe administrateur dédié.

Le pilotage courant de l'alarme restera accessible à distance dans l'interface Gladys et via Gladys Plus.

L'usage de HTTP local constitue un risque accepté : un acteur capable d'intercepter le trafic du réseau local pourrait observer les échanges. Cette limite devra être explicitement documentée.

### 3.4 Notifications

Une intégration externe de type `device` ne peut pas réutiliser directement les canaux Telegram ou Gladys Plus déjà configurés. L'intégration publiera donc des événements normalisés dans Gladys, et une scène Gladys dédiée assurera uniquement leur relais vers :

- les notifications Gladys/Gladys Plus ;
- Telegram, s'il est déjà configuré dans Gladys.

La logique d'alarme elle-même ne devra pas dépendre des scènes.

## 4. Architecture cible

```text
Gladys V5
   ↕ SDK officiel
Intégration principale
   ├── appareil virtuel « Système d'alarme »
   ├── moteur d'états et temporisations
   ├── client MQTT vers Zigbee2MQTT
   └── stockage persistant
             ↕
Conteneur compagnon
   └── interface web locale responsive
             ↕
Zigbee2MQTT 2.13.0
   ├── KEYZB-110, firmware 2.0.6
   ├── détecteurs
   └── sirènes
```

L'intégration principale doit rester capable de gérer l'alarme même si l'interface web compagnon est temporairement indisponible.

Le stockage persistant reposera sur SQLite sous `/data`, avec des migrations versionnées. La communication entre le moteur principal et l'interface devra utiliser un canal privé authentifié ou, si les contraintes du superviseur l'imposent, un stockage partagé avec un seul processus responsable des écritures métier.

## 5. Périmètre fonctionnel

### 5.1 Système et partitions

La première version gère un seul système d'alarme pour tout le logement. L'architecture pourra être préparée pour plusieurs partitions futures, sans implémenter cette fonction dans la V1.

### 5.2 Modes et états

Le moteur doit gérer au minimum :

- désarmée ;
- préparation à l'armement ;
- délai de sortie ;
- armée en mode total ou absence ;
- armée en mode partiel ou jour ;
- armée en mode nuit ;
- délai d'entrée ;
- alarme déclenchée ;
- alarme panique ;
- alarme sabotage ;
- état dégradé ou MQTT indisponible.

L'état « déclenchée » doit rester mémorisé jusqu'à un désarmement explicite, même lorsque le détecteur revient à son état normal ou que la durée de la sirène est terminée.

Après l'arrêt programmé des sirènes, un nouvel événement provenant d'un autre détecteur doit pouvoir les relancer tant que l'alarme reste déclenchée.

### 5.3 Points de commande

L'armement et le désarmement doivent être possibles depuis :

- le clavier Zigbee ;
- l'interface Gladys ;
- l'interface web locale dédiée ;
- les scènes Gladys ;
- l'API Gladys.

Depuis Gladys, le désarmement est immédiat pour un utilisateur déjà authentifié, sans nouvelle saisie de PIN.

Les automatismes horaires, de présence ou basés sur d'autres états restent pilotés par les scènes Gladys.

## 6. Intégration Zigbee2MQTT

### 6.1 Couche MQTT

Le client MQTT doit assurer :

- la connexion et la reconnexion avec backoff ;
- le suivi de disponibilité du broker et de Zigbee2MQTT ;
- l'abonnement aux sujets nécessaires ;
- la découverte depuis les informations du bridge ;
- la normalisation des appareils et de leurs capacités ;
- la publication des commandes ;
- la déduplication et l'ordonnancement des événements ;
- une resynchronisation après reconnexion ;
- des journaux ne contenant aucun secret ni code PIN.

En cas de perte de MQTT pendant que l'alarme est armée :

- l'état armé est conservé ;
- le système est marqué indisponible ou dégradé ;
- aucune transition implicite vers « désarmée » n'est autorisée ;
- la reprise est automatique au retour de la connexion.

### 6.2 Adaptateur KEYZB-110

La première version doit prendre en charge les données Zigbee2MQTT suivantes :

- `action` ;
- `action_code` ;
- `action_transaction` ;
- `action_zone` ;
- `battery` ;
- `voltage` ;
- `battery_low` ;
- `tamper`.

L'adaptateur doit également :

- valider le code et la commande demandée ;
- répondre en réutilisant le même numéro de transaction ;
- envoyer `invalid_code`, `not_ready` ou `already_disarmed` lorsque nécessaire ;
- synchroniser les modes du clavier avec le moteur d'alarme ;
- piloter les voyants et le buzzer ;
- refléter le délai d'entrée ;
- refléter le délai de sortie ;
- signaler l'armement, le désarmement, un code invalide et une alarme.

Les différences de comportement liées au firmware 2.0.6, notamment pour les notifications sonores IAS ACE, doivent être couvertes par les essais matériels.

### 6.3 Extensibilité

Les claviers devront être implémentés derrière une interface d'adaptateur par modèle. La V1 ne certifie que le KEYZB-110, mais un nouveau modèle devra pouvoir être ajouté sans modifier le moteur d'alarme.

## 7. Zones et équipements

### 7.1 Découverte et capacité

L'interface doit afficher les équipements Zigbee2MQTT compatibles avec :

- les contacts d'ouverture ;
- les détecteurs de mouvement ;
- le sabotage ;
- la batterie ;
- les sirènes ;
- les claviers.

Il ne doit exister aucune limite fonctionnelle arbitraire au nombre d'équipements. L'interface et les API devront employer pagination, recherche et traitements bornés afin de rester utilisables avec de grands inventaires. Les limites réelles restent celles du réseau Zigbee et des ressources de la machine.

### 7.2 Organisation en zones

Les équipements pourront être associés à des zones configurables, dont les profils initiaux suivants :

- périmètre ;
- intérieur ;
- entrée temporisée ;
- zone permanente 24 h ;
- sabotage.

Pour chaque combinaison de zone et de mode d'armement, l'administrateur doit pouvoir définir :

- si la zone est active ;
- un délai d'entrée ;
- un délai de sortie ;
- un déclenchement immédiat ou temporisé ;
- le comportement si un capteur est déjà actif ;
- l'autorisation ou l'interdiction du contournement temporaire.

Si un détecteur est ouvert au moment de l'armement, la configuration pourra imposer soit le refus de l'armement, soit un contournement temporaire. Tout contournement doit être journalisé et visible jusqu'au prochain désarmement.

## 8. Temporisations et reprise

Les délais d'entrée et de sortie doivent être configurables :

- par mode d'armement ;
- individuellement par zone.

Les échéances actives doivent être persistées. Après un redémarrage de Gladys ou du conteneur :

- le dernier état d'armement est restauré ;
- une temporisation encore valide reprend avec sa durée restante ;
- une échéance dépassée provoque immédiatement la transition attendue ;
- le clavier et l'appareil virtuel Gladys sont resynchronisés.

## 9. Codes PIN et utilisateurs

### 9.1 Gestion des codes

L'intégration doit gérer plusieurs codes nominatifs de 4 à 8 chiffres.

Chaque code peut être :

- permanent ;
- temporaire avec une date d'expiration ;
- limité à des jours et plages horaires ;
- autorisé seulement pour certaines opérations ;
- autorisé seulement pour certains modes ;
- désactivé sans supprimer son historique ;
- marqué comme code de contrainte.

Les codes doivent être uniques selon les règles de sécurité retenues et ne jamais apparaître en clair dans les journaux, exports ordinaires ou réponses API.

### 9.2 Code de contrainte

Lorsqu'un code de contrainte valide est saisi :

1. le système doit paraître se désarmer normalement ;
2. le clavier doit afficher un désarmement normal ;
3. les sirènes éventuellement actives doivent s'arrêter ;
4. une alerte silencieuse doit être enregistrée ;
5. un événement de notification doit être publié ;
6. rien dans l'interface visible ne doit signaler à l'agresseur qu'un code de contrainte a été employé.

### 9.3 Codes invalides

Le seuil de codes invalides et la durée du verrouillage doivent être configurables.

Le système doit assurer :

- une limitation du débit des tentatives ;
- un verrouillage temporaire après dépassement du seuil ;
- la journalisation de l'événement ;
- une alerte de sécurité ;
- une réponse cohérente au clavier.

### 9.4 Stockage sécurisé

Les codes et mots de passe doivent être protégés au moyen :

- d'une fonction de dérivation lente adaptée ;
- de sels uniques ;
- d'un secret interne supplémentaire lorsque cela est possible ;
- de comparaisons en temps constant ;
- d'un masquage systématique dans la télémétrie et les erreurs.

La faiblesse intrinsèque d'un espace de 4 à 8 chiffres devra être prise en compte dans le modèle de menace, les limites de tentative et le format des sauvegardes.

## 10. Sirènes, panique, sabotage et maintenance

### 10.1 Sirènes

L'utilisateur doit pouvoir sélectionner une ou plusieurs sirènes Zigbee et configurer, lorsqu'elles sont supportées :

- la durée ;
- le volume ;
- le signal lumineux ;
- le comportement par type d'alerte.

L'intégration doit adapter ses commandes aux capacités réellement exposées par chaque sirène.

### 10.2 Alarme panique

La touche d'urgence du KEYZB-110 doit fonctionner quel que soit le mode d'armement. La configuration permettra de choisir entre :

- panique sonore avec sirènes ;
- panique silencieuse avec notification uniquement.

### 10.3 Sabotage

L'ouverture ou l'arrachement d'un clavier, d'un détecteur ou d'une sirène doit déclencher une alarme sabotage, même lorsque le système est désarmé.

### 10.4 Maintenance

Une batterie faible ou un équipement hors ligne doit produire une alerte de maintenance sans déclencher les sirènes.

Le délai d'inactivité au-delà duquel un équipement est considéré hors ligne doit être configurable par type d'équipement.

## 11. Appareil virtuel Gladys

L'intégration publiera un appareil virtuel nommé **Système d'alarme** avec au minimum les fonctions suivantes :

- mode demandé, modifiable ;
- état réel, en lecture seule ;
- alarme active ;
- délai d'entrée actif ;
- délai de sortie actif ;
- secondes restantes ;
- détecteur à l'origine de l'alerte ;
- sirènes actives ;
- état global de santé ;
- disponibilité MQTT ;
- événement de notification.

Le mode demandé et l'état réel doivent rester distincts afin de ne pas annoncer un armement avant sa confirmation effective.

Les états publiés permettront :

- l'affichage sur le tableau de bord Gladys ;
- le pilotage depuis Gladys ;
- l'utilisation dans des scènes ;
- la consultation de l'état par l'API Gladys ;
- le relais des notifications.

## 12. Interface web locale

### 12.1 Écrans

L'interface comprendra au minimum :

1. une vue d'ensemble et de pilotage ;
2. les équipements découverts ;
3. les zones et la matrice des modes ;
4. les délais d'entrée et de sortie ;
5. les claviers et leurs retours sonores ;
6. les sirènes et l'alarme panique ;
7. les utilisateurs, codes et permissions ;
8. la santé MQTT et Zigbee ;
9. le journal des événements ;
10. la sauvegarde, la restauration et la maintenance.

### 12.2 Authentification

L'interface sera protégée par :

- un mot de passe administrateur dédié ;
- des cookies de session `HttpOnly` ;
- une politique `SameSite` appropriée ;
- une protection CSRF ;
- une expiration des sessions ;
- une limitation des tentatives de connexion ;
- l'invalidation des sessions lors d'un changement ou d'une réinitialisation de mot de passe.

Une action depuis la configuration de l'intégration Gladys permettra de réinitialiser le mot de passe administrateur et d'invalider toutes les sessions ouvertes.

## 13. Notifications

L'intégration doit publier des événements distincts et exploitables pour :

- intrusion ;
- sabotage ;
- panique ;
- contrainte silencieuse ;
- codes invalides répétés ;
- batterie faible ;
- équipement hors ligne ;
- perte de MQTT ;
- restauration du service.

La première phase devra déterminer si une scène Gladys unique peut produire un message suffisamment détaillé pour tous ces événements. Si le moteur de scènes ne permet pas un message dynamique, quelques scènes de relais par famille d'événement pourront être nécessaires. Cette éventuelle multiplication ne devra jamais déplacer la logique d'alarme hors de l'intégration.

## 14. Journal des événements

Le journal doit conserver, sans expiration automatique :

- les armements et désarmements ;
- l'identité nominale associée au code utilisé, jamais la valeur du PIN ;
- les changements de mode ;
- les déclenchements ;
- les détecteurs concernés ;
- les sabotages ;
- les alarmes panique ;
- les contraintes silencieuses, sous une présentation réservée à l'administrateur ;
- les contournements ;
- les erreurs de code ;
- les indisponibilités ;
- les alertes de maintenance ;
- les actions administratives.

L'interface doit proposer :

- pagination ;
- recherche et filtres ;
- affichage de la taille de la base ;
- export du journal ;
- effacement volontaire réservé à l'administrateur ;
- confirmation renforcée avant effacement.

## 15. Sauvegarde et restauration

L'utilisateur doit pouvoir exporter et restaurer :

- les zones ;
- les associations d'équipements ;
- les modes et délais ;
- les règles de contournement ;
- les sirènes ;
- les utilisateurs et permissions ;
- les codes sans jamais les exposer en clair ;
- les paramètres fonctionnels ;
- le journal, si l'utilisateur le choisit.

La sauvegarde complète doit être chiffrée par une phrase secrète fournie lors de l'export. Elle pourra contenir les vérificateurs et secrets nécessaires à la restauration des codes, mais jamais leurs valeurs en clair.

Les identifiants MQTT devront de préférence être exclus de l'export et ressaisis après restauration.

## 16. Exigences de résilience

- L'intégration ne doit jamais passer silencieusement d'armée à désarmée après une erreur ou un redémarrage.
- Les transitions doivent être atomiques et journalisées.
- Les temporisations doivent survivre aux redémarrages.
- Les événements du clavier doivent être dédupliqués avec leur transaction.
- Les erreurs d'un équipement ne doivent pas arrêter tout le moteur.
- Une sirène indisponible doit être signalée sans empêcher la journalisation de l'alarme.
- Le moteur principal doit continuer à fonctionner si l'interface d'administration est arrêtée.
- Les migrations de base doivent être transactionnelles et testées.
- La corruption ou l'incompatibilité de configuration doit produire un état dégradé explicite, jamais une réinitialisation silencieuse.

## 17. Plan de développement

### Phase 0 — Validation de faisabilité

1. Connecter le template au broker MQTT utilisé par Gladys.
2. Lire `zigbee2mqtt/bridge/devices`.
3. Identifier et contrôler le KEYZB-110.
4. Publier un appareil virtuel minimal dans Gladys.
5. Démarrer un conteneur compagnon avec un port web nommé.
6. Valider la communication privée et la persistance.
7. Tester un événement relayé par une scène Gladys vers les canaux configurés.

La suite du développement ne commencera qu'après validation de ces points structurants.

### Phase 1 — Initialisation du projet

- importer le template officiel ;
- configurer le manifeste ;
- supprimer les appareils de démonstration ;
- installer la structure métier ;
- préparer les images multiarchitectures ;
- configurer formatage, lint, tests et build ;
- créer la documentation française et anglaise.

### Phase 2 — Couche Zigbee2MQTT

- développer le client MQTT ;
- développer la découverte ;
- normaliser les capacités ;
- ajouter l'adaptateur KEYZB-110 ;
- ajouter les fixtures de messages Zigbee2MQTT ;
- tester reconnexion et déduplication.

### Phase 3 — Moteur d'alarme

- définir les événements et transitions ;
- implémenter la machine à états ;
- implémenter les temporisations ;
- persister état et échéances ;
- restaurer l'état après redémarrage ;
- publier les états dans Gladys.

### Phase 4 — Zones et détecteurs

- construire le catalogue d'équipements ;
- créer les zones ;
- créer la matrice zone/mode ;
- implémenter les délais ;
- implémenter le refus et le contournement ;
- tester les déclenchements simultanés.

### Phase 5 — Sirènes, panique et sabotage

- découvrir les capacités des sirènes ;
- piloter son, volume, durée et lumière ;
- gérer les relances ;
- implémenter panique silencieuse et sonore ;
- implémenter sabotage 24 h/24 ;
- implémenter les alertes de maintenance.

### Phase 6 — Codes et sécurité

- créer les utilisateurs et codes nominatifs ;
- implémenter dates, horaires et permissions ;
- implémenter la contrainte silencieuse ;
- implémenter le verrouillage après erreurs ;
- durcir stockage, API et journaux.

### Phase 7 — Interface web

- construire les écrans responsive ;
- ajouter l'internationalisation ;
- ajouter l'authentification ;
- intégrer les formulaires métier ;
- ajouter le journal ;
- ajouter sauvegarde et restauration ;
- intégrer l'action Gladys de réinitialisation du mot de passe.

### Phase 8 — Notifications

- définir le format des événements ;
- publier les impulsions utilisables par Gladys ;
- valider le relais Gladys Plus ;
- valider le relais Telegram ;
- documenter la ou les scènes nécessaires.

### Phase 9 — Validation finale

- exécuter tous les tests automatisés ;
- valider AMD64 et ARM64 ;
- réaliser la matrice de tests matériels ;
- tester les redémarrages et pertes réseau ;
- effectuer une revue de sécurité ;
- vérifier le manifeste avec le validateur du store, sans publier ;
- finaliser la documentation utilisateur et développeur.

## 18. Stratégie de tests

### 18.1 Tests unitaires

- toutes les transitions de la machine d'états ;
- toutes les matrices zone/mode ;
- temporisations avec horloge simulée ;
- refus et contournement ;
- codes permanents, temporaires et expirés ;
- plages horaires et permissions ;
- code de contrainte ;
- verrouillage après erreurs ;
- reprise après redémarrage ;
- migrations SQLite ;
- absence de secrets dans les journaux.

### 18.2 Tests d'intégration

- broker Mosquitto isolé ;
- fixtures Zigbee2MQTT réalistes ;
- déconnexion et reconnexion ;
- messages dupliqués ou désordonnés ;
- redémarrage du conteneur ;
- API entre moteur et interface ;
- persistance SQLite ;
- contrat avec le SDK Gladys ;
- commandes depuis l'appareil virtuel.

### 18.3 Tests de bout en bout

- connexion administrateur ;
- parcours mobile et ordinateur ;
- création de zones et de codes ;
- armement total, jour et nuit ;
- délai d'entrée et de sortie ;
- intrusion ;
- sabotage ;
- panique silencieuse et sonore ;
- contrainte silencieuse ;
- sirènes ;
- notification relayée ;
- export, effacement et restauration.

### 18.4 Tests matériels

La matrice initiale doit inclure :

- Gladys 5.0.1 ;
- Zigbee2MQTT 2.13.0 ;
- KEYZB-110 firmware 2.0.6 ;
- architectures AMD64 et ARM64 ;
- détecteur d'ouverture ;
- détecteur de mouvement ;
- équipement exposant le sabotage ;
- sirène Zigbee réelle ;
- coupure et retour du broker MQTT ;
- redémarrage pendant une temporisation ;
- redémarrage pendant que le système est armé.

## 19. Critères d'acceptation de la V1

La V1 sera considérée fonctionnelle lorsque les preuves représentatives suivantes seront obtenues :

1. Le KEYZB-110 s'arme et se désarme avec confirmation correcte de transaction.
2. Les modes total, jour et nuit activent les bonnes zones.
3. Les délais configurés par mode et par zone sont respectés.
4. Un capteur déjà actif provoque le refus ou le contournement selon la configuration.
5. Un code valide, invalide, expiré, hors horaire et sans permission produit le résultat attendu.
6. Un code de contrainte produit un désarmement apparent et une alerte silencieuse.
7. Les voyants et le buzzer du KEYZB-110 reflètent les états du système avec le firmware 2.0.6.
8. Une intrusion déclenche les sirènes configurées et mémorise l'alarme.
9. Un nouvel événement peut relancer les sirènes.
10. La panique silencieuse et la panique sonore fonctionnent.
11. Le sabotage déclenche une alarme lorsque le système est désarmé.
12. Les batteries faibles et équipements hors ligne produisent une maintenance sans sirène.
13. Le système reste armé après une perte MQTT et se resynchronise au retour.
14. Le dernier état et les temporisations sont restaurés après redémarrage.
15. Gladys affiche et pilote correctement l'appareil virtuel.
16. Une scène relaie les événements vers Gladys Plus et Telegram configuré.
17. L'interface locale fonctionne sur ordinateur, tablette et smartphone en français et en anglais.
18. L'interface est protégée et le mot de passe peut être réinitialisé depuis Gladys.
19. Le journal est conservé jusqu'à son effacement volontaire.
20. Une sauvegarde chiffrée peut être restaurée sans exposition des codes en clair.
21. Les tests automatisés, les tests matériels et les constructions AMD64/ARM64 réussissent.

## 20. Hors périmètre de la V1

- modification du cœur ou de l'interface native de Gladys ;
- plusieurs partitions indépendantes ;
- certification de claviers autres que le KEYZB-110 ;
- envoi direct par l'intégration vers les canaux Telegram ou Gladys Plus existants ;
- automatisation horaire ou par présence interne au moteur ;
- publication publique dans le catalogue pendant le développement ;
- accès distant automatique à l'interface web compagnon ;
- HTTPS intégré obligatoire.

## 21. Publication future

La publication n'est pas autorisée pendant le développement. Les workflows pourront préparer :

- une image multiarchitecture ;
- une validation du manifeste ;
- une couverture conforme au catalogue ;
- une documentation bilingue ;
- un versionnement cohérent.

Aucune image publique, aucun dépôt public et aucune entrée de catalogue ne devront être créés sans une demande ultérieure explicite.
