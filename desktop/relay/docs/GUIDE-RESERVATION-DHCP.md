# Guide simple — Réservation DHCP du PC relais Mon Cahier

## Objectif

Le PC relais doit conserver **la même adresse IP locale** sur le réseau de l’établissement, même après un redémarrage du PC, une coupure électrique ou un renouvellement DHCP.

La méthode recommandée est la **réservation DHCP dans le routeur**.

Exemple :

```text
PC relais Mon Cahier
Adresse MAC : AA-BB-CC-DD-EE-FF
IP réservée : 192.168.1.50

Routeur
→ voit cette adresse MAC
→ redonne toujours 192.168.1.50 à ce PC
```

Windows reste en adressage automatique. **Ne configurez pas une IP statique manuellement dans Windows.**

---

## En une minute

1. Sur le PC relais, double-cliquez sur `windows\Assistant-Reservation-DHCP.cmd`.
2. Notez les trois valeurs affichées :
   - **Adresse MAC du PC**
   - **IP à réserver**
   - **Passerelle / adresse du routeur**
3. Ouvrez la page du routeur.
4. Cherchez une rubrique appelée :
   - `DHCP Reservation`
   - `Address Reservation`
   - `Static Lease`
   - `Bail statique`
   - `Liaison IP-MAC`
   - `DHCP statique`
5. Ajoutez le PC relais avec **la MAC affichée** et **l’IP affichée**.
6. Enregistrez.
7. Reconnectez ou redémarrez le PC.
8. Relancez l’assistant : l’IP doit être restée identique.
9. Depuis un téléphone connecté au même réseau, ouvrez :

```text
http://IP_RESERVEE:4317/health
```

Le résultat doit contenir :

```json
{"ok": true}
```

---

# 1. Conditions à respecter

Pour utiliser le relais local sans Internet :

- le PC relais doit être allumé ;
- le téléphone et le PC relais doivent être connectés au **même LAN / Wi-Fi d’établissement** ;
- le réseau Windows du PC doit être classé **Privé** ;
- le pare-feu Windows doit autoriser le port TCP `4317` sur le profil Privé ;
- le routeur ne doit pas activer une isolation empêchant les appareils du LAN de communiquer entre eux ;
- la réservation DHCP doit être faite sur le routeur qui distribue réellement les adresses IP du réseau.

Internet n’est **pas nécessaire** pour joindre le relais une fois la réservation en place.

---

# 2. Ce qu’il faut préparer

Vous avez besoin de :

- l’accès au PC relais ;
- l’accès administrateur au routeur ou à la box de l’établissement ;
- le mot de passe d’administration du routeur.

Le mot de passe peut être :

- indiqué sur une étiquette de la box ;
- fourni par l’installateur réseau ;
- détenu par l’administrateur informatique de l’établissement.

Si personne ne possède cet accès, demandez au technicien réseau de créer la réservation DHCP.

---

# 3. Obtenir automatiquement les bonnes informations

Sur le PC relais :

1. ouvrez le dossier Mon Cahier ;
2. allez dans `desktop\relay\windows` ;
3. double-cliquez sur :

```text
Assistant-Reservation-DHCP.cmd
```

L’assistant détecte automatiquement la connexion réellement utilisée par le PC et affiche notamment :

```text
Réseau         : WIFI-ECOLE
Carte réseau   : Wi-Fi
Profil Windows : Private
DHCP Windows   : Enabled

MAC du PC      : AA-BB-CC-DD-EE-FF
IP à réserver  : 192.168.1.50
Passerelle     : 192.168.1.1
Port relais    : 4317
Test relais    : OK
```

Il crée aussi un rapport local dans :

```text
%LOCALAPPDATA%\MonCahier\Relay\reservation-dhcp-a-configurer.txt
```

et copie les informations utiles dans le presse-papiers.

---

# 4. Ouvrir le routeur

L’assistant peut proposer d’ouvrir automatiquement :

```text
http://ADRESSE_DE_LA_PASSERELLE
```

Exemple :

```text
http://192.168.1.1
```

Selon le routeur, l’interface peut aussi utiliser HTTPS ou une autre adresse. Si la page ne s’ouvre pas, consultez l’étiquette du routeur ou sa documentation.

---

# 5. Trouver la rubrique DHCP

Les noms changent selon la marque. Cherchez généralement :

```text
LAN
  └── DHCP
       └── Address Reservation
```

ou :

```text
Network
  └── LAN
       └── Static Lease
```

ou encore :

```text
Réseau local
  └── Serveur DHCP
       └── Réservation / Bail statique
```

Le principe est toujours le même : associer **une adresse MAC** à **une adresse IP locale**.

---

# 6. Créer la réservation

Utilisez **exactement l’IP actuelle proposée par l’assistant**.

Exemple :

```text
Nom de l’appareil : MON-CAHIER-RELAIS
Adresse MAC       : AA-BB-CC-DD-EE-FF
Adresse IP        : 192.168.1.50
Statut            : Activé
```

Pourquoi utiliser l’IP actuelle ?

Parce que le routeur l’a déjà attribuée à ce PC. On évite ainsi de choisir au hasard une adresse susceptible d’être utilisée par un autre appareil.

Enregistrez avec un bouton du type :

```text
Save
Apply
Enregistrer
Appliquer
```

---

# 7. Faire prendre en compte la réservation

Après l’enregistrement :

- déconnectez puis reconnectez le Wi-Fi du PC relais ; ou
- redémarrez le PC.

Il n’est normalement pas nécessaire de modifier quoi que ce soit dans Windows.

Relancez ensuite :

```text
Assistant-Reservation-DHCP.cmd
```

L’adresse affichée doit être la même que celle réservée.

---

# 8. Validation Mon Cahier

Sur le PC :

```text
IP réservée : 192.168.1.50
```

Sur un téléphone connecté au même Wi-Fi :

```text
http://192.168.1.50:4317/health
```

Le téléphone doit recevoir une réponse contenant :

```json
{"ok": true}
```

Ensuite, faites le vrai test de résilience :

```text
Wi-Fi / LAN : ON
PC relais   : ON
Internet    : OFF
```

Le téléphone doit toujours pouvoir joindre :

```text
http://192.168.1.50:4317/health
```

Si oui, la réservation DHCP remplit exactement son rôle : **le LAN Mon Cahier continue de fonctionner sans Internet**.

---

# 9. Test après redémarrage

Pour valider définitivement l’installation :

1. notez l’IP réservée ;
2. redémarrez le PC relais ;
3. vérifiez que le relais démarre automatiquement ;
4. relancez l’assistant DHCP ;
5. vérifiez que l’IP est inchangée ;
6. testez `/health` depuis le téléphone.

Vous pouvez aussi redémarrer le routeur à un moment de maintenance puis refaire le même contrôle.

---

# 10. Ce qu’il ne faut surtout pas faire

## Ne pas mettre une IP statique manuellement dans Windows

Évitez :

```text
Paramètres Windows
→ IPv4
→ adresse saisie manuellement
```

La réservation doit être gérée par le routeur. Cela facilite les déplacements, remplacements de routeur et opérations de maintenance.

## Ne pas désactiver DHCP sur le routeur

On ne supprime pas le serveur DHCP. On lui demande simplement de réserver une adresse au PC relais.

## Ne pas faire de redirection de port vers Internet

Ne créez pas de règle du type :

```text
Internet → TCP 4317 → PC relais
```

Le port `4317` est destiné au **réseau local de l’établissement**, pas à Internet.

## Ne pas réserver une IP au hasard

Utilisez l’adresse proposée par l’assistant, sauf si le technicien réseau maîtrise le plan d’adressage de l’établissement.

---

# 11. Si le routeur ne propose pas de réservation DHCP

Trois solutions, dans cet ordre :

1. demander au technicien réseau ou au fournisseur de la box d’effectuer la réservation ;
2. utiliser un routeur d’établissement permettant les réservations DHCP ;
3. ajouter un petit routeur dédié au LAN Mon Cahier si l’infrastructure existante est trop limitée.

Le mDNS `.local` peut rester un mécanisme supplémentaire lorsque le réseau le supporte, mais il ne doit pas remplacer la réservation DHCP sur une installation fixe.

---

# 12. Cas des hotspots de téléphone

Un hotspot Android peut attribuer une IP différente au PC et ne propose généralement pas une interface d’administration DHCP aussi complète qu’un routeur classique.

Le hotspot est donc utile pour les tests et le dépannage, mais **ce n’est pas l’installation réseau de référence recommandée pour un établissement**.

Pour une école, privilégiez :

```text
Box / routeur / point d’accès fixe
          │
      réseau LAN
      ┌────┴────┐
      │         │
 PC relais   téléphones
```

avec réservation DHCP du PC relais.

---

# 13. Si le routeur est remplacé

Une réservation DHCP appartient au routeur.

Si la box ou le routeur de l’établissement est remplacé :

1. lancez `Assistant-Reservation-DHCP.cmd` ;
2. récupérez les nouvelles informations réseau ;
3. recréez la réservation dans le nouveau routeur ;
4. vérifiez `/health`.

Il s’agit d’une opération ponctuelle.

---

# 14. Dépannage rapide

## `/health` fonctionne sur le PC mais pas sur le téléphone

Vérifiez :

- téléphone et PC sur le même Wi-Fi ;
- réseau Windows en `Private` ;
- règle pare-feu TCP `4317` active ;
- absence d’isolation Wi-Fi / AP isolation / client isolation.

## L’IP a changé malgré la réservation

Vérifiez :

- que la MAC réservée est celle de la carte réseau réellement utilisée ;
- que la réservation est activée ;
- que vous avez modifié le bon routeur ;
- qu’un autre serveur DHCP n’existe pas sur le réseau ;
- que le PC n’utilise pas une autre carte réseau.

## Le PC passe du Wi-Fi à Ethernet

Chaque carte réseau possède sa propre adresse MAC.

Si le PC relais peut utiliser indifféremment Ethernet et Wi-Fi, créez une réservation DHCP pour **chaque carte réellement utilisée**, ou choisissez un seul mode de connexion comme standard d’installation.

---

# 15. Standard Mon Cahier recommandé

Pour une installation normale :

```text
1. PC relais installé
2. Réseau Windows = Private
3. TCP 4317 autorisé uniquement en Private
4. DHCP Windows = automatique
5. Réservation DHCP créée dans le routeur
6. IP du relais enregistrée dans Mon Cahier
7. Test /health depuis le téléphone
8. Test sans Internet
9. Redémarrage PC
10. Nouveau test /health
```

Résultat recherché :

```text
Internet disponible ou non
        ↓
LAN de l’école opérationnel
        ↓
PC relais toujours à la même IP
        ↓
Mon Cahier continue à fonctionner
```
