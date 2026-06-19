# Le jargon de lemura, expliqué simplement

Ce document explique **tous les termes techniques** utilisés dans lemura, en langage clair, pour quelqu'un qui n'est pas développeur. Chaque entrée suit le même format :

> **\<Nom du concept\>** : explication simple
> **Exemple / Illustration / Pourquoi faire ?**

`lemura` est une « boîte à outils » qui permet de construire un **agent IA** — un assistant qui ne se contente pas de répondre, mais qui peut *raisonner*, *utiliser des outils* et *agir* étape par étape pour accomplir une tâche.

---

## Les grands concepts

### Agent
**C'est quoi ?** Un assistant IA autonome. Au lieu de juste discuter, il peut décider d'agir : chercher une info, appeler un outil, vérifier un résultat, puis recommencer jusqu'à ce que la tâche soit finie.

**Illustration :** Comparez un **GPS** (« tourne à droite », passif) à un **chauffeur** : vous lui dites « emmène-moi à la gare », il choisit la route, s'adapte aux bouchons, et vous dépose. lemura fabrique le chauffeur.

---

### ReAct (boucle Reason + Act)
**C'est quoi ?** Le « cerveau qui tourne en rond » de l'agent. C'est un cycle : **Raisonner → Agir → Observer le résultat → recommencer**, jusqu'à ce que la réponse soit prête.

**Illustration :** Un cuisinier qui prépare un plat : il goûte (observe), ajuste le sel (raisonne), remet une pincée (agit), regoûte… et s'arrête quand c'est bon. Chaque tour de cette boucle s'appelle une **itération**.

---

### Turn (un « tour » de conversation)
**C'est quoi ?** Un message dans la conversation. Chaque prise de parole est un *turn* : votre question est un turn, la réponse de l'IA en est un autre, le résultat d'un outil aussi.

**Exemple :**
- Turn 1 (vous) : « Quel temps fait-il à Paris ? »
- Turn 2 (l'IA) : *décide d'utiliser l'outil météo*
- Turn 3 (l'outil) : « 18°C, ensoleillé »
- Turn 4 (l'IA) : « Il fait 18°C et beau à Paris. »

---

### Pre-turn (« avant le tour »)
**C'est quoi ?** Un moment précis où l'on glisse une information **juste avant** que l'IA ne reçoive un nouveau message. Un rappel discret posé sur la table avant qu'elle ne parle.

**Pourquoi faire ?** Pour rappeler à l'IA quelque chose d'important à chaque tour, par exemple : « N'oublie pas, l'objectif est de réserver un vol pas cher. » (voir [Goal](#goal--objectif))

---

### System prompt (consigne de base)
**C'est quoi ?** Les instructions permanentes données à l'IA au tout début, qui définissent son rôle et son comportement. Elles ne changent pas pendant la conversation.

**Exemple :** « Tu es un assistant juridique. Réponds toujours en citant tes sources et reste prudent. »

---

## Les outils et leurs garde-fous

### Tool (outil)
**C'est quoi ?** Une capacité concrète que l'agent peut déclencher : chercher sur le web, lire un fichier, envoyer un email, interroger une base de données.

**Illustration :** Une trousse à outils. L'IA est la main qui choisit le bon outil au bon moment — le marteau pour le clou, le tournevis pour la vis.

---

### ToolRegistry (registre d'outils)
**C'est quoi ?** L'inventaire de tous les outils disponibles. L'agent y pioche, et on peut en ajouter de nouveaux à tout moment.

**Illustration :** Le tableau accroché au mur d'un atelier, avec une silhouette dessinée pour chaque outil. On voit d'un coup d'œil ce qui est disponible.

---

### Autodiscovery (découverte automatique des outils)
**C'est quoi ?** lemura peut **trouver tout seul** les outils livrés avec d'autres logiciels installés, sans qu'on ait à les déclarer un par un.

**Pourquoi faire ?** Vous installez un module « outils Google Agenda » → l'agent sait automatiquement gérer votre calendrier, sans réglage manuel.

---

### maxSteps (nombre maximum d'actions)
**C'est quoi ?** Une limite sur le **nombre d'outils** que l'agent a le droit d'utiliser pour une tâche. Quand la limite est atteinte, on lui demande de conclure avec ce qu'il a.

**Pourquoi faire ?** Éviter qu'il « parte en boucle » et coûte cher. C'est comme dire à un chercheur : « Tu as droit à 20 coups de fil pour ce dossier, ensuite tu rends ta conclusion. »

---

### maxIterations (nombre maximum de tours)
**C'est quoi ?** La limite sur le **nombre de cycles complets** de réflexion (voir [ReAct](#react-boucle-reason--act)). Différent de `maxSteps`, qui compte les outils ; ici on compte les tours de cerveau.

**Illustration :** « Tu peux relire et corriger ta copie 10 fois maximum, après tu rends. »

---

### Tool firewall (pare-feu d'outils)
**C'est quoi ?** Un videur à l'entrée de chaque outil. Pour chaque action, il dit : **autoriser**, **refuser** ou **demander** la permission d'un humain.

**Pourquoi faire ?** Sécurité. On peut décider que l'IA peut lire des fichiers librement, mais qu'elle doit **demander** avant d'envoyer un email ou de supprimer quoi que ce soit. Par défaut, dans le doute, on bloque (« fail-safe »).

---

### Tool execution budget (budget d'actions)
**C'est quoi ?** Un plafond de dépenses : « pas plus de 50 outils en tout, pas plus de 10 recherches web, pas plus de 4 actions en même temps ».

**Pourquoi faire ?** Maîtriser le coût et la vitesse, comme un forfait téléphone avec des limites par type d'appel.

---

### Parallel tool calls (appels d'outils en parallèle)
**C'est quoi ?** Lancer plusieurs outils **en même temps** quand ils ne dépendent pas l'un de l'autre, au lieu de les enchaîner un par un.

**Illustration :** Pour préparer un dîner, vous lancez le four **et** coupez les légumes en même temps, plutôt que d'attendre que le four chauffe pour commencer à couper.

---

## Donner et tenir un cap

### Goal (objectif)
**C'est quoi ?** La formulation claire de ce que l'utilisateur veut vraiment, avec ses sous-étapes et ses critères de réussite. lemura le garde en mémoire et le rappelle régulièrement à l'IA.

**Exemple :** Objectif = « Organiser un week-end à Rome ». Sous-objectifs = trouver un vol, réserver un hôtel, lister 3 visites. Critère de réussite = « les trois sont réservés ».

---

### GoalPlanner / Goal planning (planification de l'objectif)
**C'est quoi ?** Avant de foncer, l'agent **découpe** la demande en petites étapes et définit à quoi ressemblera « terminé ».

**Illustration :** Avant de partir en randonnée, on déplie la carte et on trace l'itinéraire avec les points de passage, plutôt que de marcher au hasard.

---

### Goal verification (vérification de l'objectif)
**C'est quoi ?** À la fin, l'agent **se relit** et se demande honnêtement : « Ai-je vraiment fait tout ce qui était demandé ? » Si non, il repart travailler sur ce qui manque.

**Pourquoi faire ?** Éviter les réponses qui *ont l'air* finies mais oublient la moitié de la demande. C'est l'élève qui vérifie qu'il a bien répondu à **toutes** les questions de l'énoncé avant de rendre.

---

### StepVerifier / Goal verifier (le « vérificateur »)
**C'est quoi ?** La fonction qui rend le verdict de la vérification : *objectif atteint* (`achieved`) ou *non, voici ce qui manque* (`missing`). On peut écrire le sien ou laisser lemura juger.

**Exemple :** Verdict = « Pas atteint : il manque la confirmation de l'hôtel. » → l'agent retourne réserver l'hôtel.

---

### Goal progress reconciliation (mise à jour du suivi)
**C'est quoi ?** De temps en temps, l'agent fait le point : « Quelles sous-étapes sont déjà finies ? » et coche ce qui est fait, pour ne pas refaire deux fois la même chose ni « oublier » qu'il a avancé.

**Illustration :** Cocher au fur et à mesure les cases de sa liste de courses, pour ne pas racheter le lait qu'on a déjà mis dans le panier.

---

### Continuation plan (plan d'enchaînement)
**C'est quoi ?** Un plan d'actions avec un ordre et des dépendances : « fais d'abord A, puis B qui a besoin du résultat de A, puis C ». Si une étape échoue, celles qui en dépendaient sont sautées.

**Exemple :** 1) chercher des documents → 2) en extraire les noms → 3) croiser ces noms → 4) écrire le rapport. L'étape 4 ne peut pas commencer avant la 3.

---

## La mémoire (plusieurs sortes !)

### Context window (fenêtre de contexte)
**C'est quoi ?** La « mémoire de travail » de l'IA : tout ce qu'elle a sous les yeux à un instant donné. Elle est **limitée** — comme un bureau de taille fixe : passé un certain point, il faut ranger pour faire de la place.

**Illustration :** Un tableau blanc. On peut tout écrire, mais quand il est plein, il faut effacer ou résumer pour continuer.

---

### Token
**C'est quoi ?** L'unité de mesure du texte pour une IA — environ un petit bout de mot. La fenêtre de contexte se mesure en tokens.

**Exemple :** « bonjour » ≈ 2 tokens. On compte les tokens comme on compterait les caractères restants dans un SMS : ça dit combien de place il reste.

---

### Compression de contexte (et stratégies)
**C'est quoi ?** Quand le « bureau » se remplit, lemura **résume** les vieux échanges pour gagner de la place sans perdre l'essentiel. Plusieurs méthodes (« stratégies ») existent.

**Pourquoi faire ?** Continuer une longue conversation sans tout oublier ni dépasser la limite.

- **Sandwich** : on garde **intacts** le début (les consignes) et la fin (le plus récent), on résume le « milieu ». Comme un sandwich : on garde les deux tranches de pain, on compresse la garniture.
- **History compression** : on résume régulièrement les plus vieux messages au fur et à mesure.
- **Max tokens** : stratégie d'**urgence**, déclenchée quand c'est presque plein ; elle compresse agressivement.
- **Summary injection** : on **réinjecte** le résumé accumulé avant chaque tour, pour que l'IA n'oublie pas le passé résumé.

---

### Scratchpad (bloc-notes / brouillon)
**C'est quoi ?** Le « brouillon » privé où l'agent note son raisonnement en cours. Ce n'est pas montré tel quel et c'est effacé à chaque nouvelle question.

**Illustration :** Le brouillon d'un élève à côté de sa copie : il y pose ses calculs intermédiaires, mais ne le rend pas.

---

### STM — Short Term Memory (mémoire court terme)
**C'est quoi ?** Un endroit pour stocker de **gros morceaux** de données (un long document, un fichier) sans encombrer la fenêtre de contexte. On y garde une « étiquette » et on va chercher le contenu seulement quand on en a besoin.

**Illustration :** Un casier à la consigne : on garde le ticket (léger) dans sa poche, la grosse valise reste au casier jusqu'au moment utile.

---

### Long-term memory (mémoire long terme) — `remember` / `recall` / `forget`
**C'est quoi ?** Une mémoire **persistante d'une conversation à l'autre**. L'agent retient des faits durables (vos préférences, des infos importantes), les classe par importance, et les ressort quand c'est pertinent. Ils s'effacent doucement avec le temps s'ils ne servent plus (« décroissance »).

**Pourquoi faire ?** Pour qu'à votre retour, l'assistant se souvienne que « vous êtes végétarien » ou « vous habitez à Lyon », sans le redire. Trois outils gèrent ça : **remember** (retiens), **recall** (rappelle-toi), **forget** (oublie).

**Différence avec les autres mémoires :**
- *Contexte* = mémoire de travail de l'instant.
- *Scratchpad* = brouillon de la tâche en cours.
- *STM* = casier pour gros fichiers de la session.
- *Long terme* = carnet d'adresses qui survit aux conversations.

---

### Importance / decay / recall (importance, décroissance, rappel)
**C'est quoi ?** Trois ingrédients de la mémoire long terme. Chaque souvenir a une **importance** (note de 1 à 10), il perd de la force avec le temps (**décroissance/recency**) sauf s'il resservait souvent (**fréquence**), et il est **rappelé** quand il colle à la question du moment (**pertinence**).

**Illustration :** Notre propre mémoire : on retient mieux ce qui est important, récent, ou répété — et on oublie peu à peu ce qu'on n'utilise jamais.

---

### Reflection / consolidation (réflexion / consolidation)
**C'est quoi ?** En fin de session, l'agent peut **relire** ce qui s'est passé et noter dans sa mémoire long terme les faits durables (réflexion). La consolidation regroupe et nettoie les souvenirs redondants.

**Illustration :** Le soir, écrire dans son journal les 2-3 choses à retenir de la journée, plutôt que de tout garder en vrac.

---

## Connaissances externes et branchements

### RAG — Retrieval-Augmented Generation
**C'est quoi ?** Une technique pour donner à l'IA accès à **vos propres documents**. Au lieu de répondre « de mémoire », elle va d'abord **chercher** les passages pertinents dans une base de documents, puis répond en s'appuyant dessus.

**Pourquoi faire ?** Pour répondre sur des infos que l'IA ne connaît pas (vos contrats internes, votre catalogue produit) et **citer ses sources**.

**Illustration :** Un examen « livre ouvert ». Au lieu de répondre de tête, l'étudiant ouvre le bon chapitre, lit le paragraphe utile, et rédige sa réponse à partir de là. Les outils associés : **rag_ingest** (range les documents) et **rag_query** (va chercher dedans).

---

### MCP — Model Context Protocol
**C'est quoi ?** Une **prise standard** (comme l'USB) qui permet de brancher des serveurs d'outils extérieurs sur l'agent. Une fois branché, leurs outils deviennent utilisables comme s'ils étaient natifs.

**Pourquoi faire ?** Connecter facilement des services tiers (GitHub, une base de données, une API maison) sans réécrire de code à chaque fois.

**Illustration :** La prise USB-C : peu importe la marque de la clé, du disque ou du chargeur, ça se branche et ça marche. MCP fait pareil pour les outils d'IA.

---

### Adapter / IProviderAdapter (adaptateur de fournisseur)
**C'est quoi ?** Un **traducteur** entre lemura et un fournisseur d'IA précis (OpenAI, Anthropic, un modèle local…). lemura parle une langue unique ; l'adaptateur traduit vers chaque fournisseur.

**Pourquoi faire ?** Changer de fournisseur d'IA **sans réécrire** son application — il suffit de changer d'adaptateur. Comme un adaptateur de prise électrique quand on voyage à l'étranger : l'appareil reste le même, seul l'embout change.

---

### RAG adapter / Storage adapter (adaptateurs de stockage)
**C'est quoi ?** Sur le même principe que l'adaptateur de fournisseur, ce sont des **branchements** vers votre base de documents (RAG) ou votre système de stockage. lemura ne fournit pas la base ; il fournit la prise pour y connecter la vôtre.

**Illustration :** Une multiprise universelle : lemura propose les fiches, vous branchez vos propres appareils (votre base de données, votre moteur de recherche).

---

## Les compétences (Skills)

### Skill (compétence)
**C'est quoi ?** Un mode d'expertise qu'on **injecte** dans l'agent pour le rendre meilleur sur un sujet. C'est un texte d'instructions spécialisé (un fichier), pas du code.

**Exemple :** Une skill « expert en recherche web » apprend à l'agent à formuler de meilleures requêtes. Une skill « ton juridique » lui apprend à répondre prudemment et à citer les articles de loi.

**Illustration :** Faire suivre une **mini-formation** à un employé selon la mission du jour : aujourd'hui « accueil client », demain « comptabilité ».

---

### Skill injection / positions (où l'on place la compétence)
**C'est quoi ?** L'endroit où l'on glisse la compétence dans la conversation :
- **system_prompt** : dans les consignes de base, dès le départ (le plus courant).
- **pre_turn** : rappelée juste avant chaque message.
- **post_history** : ajoutée juste avant que l'IA ne réponde.

**Illustration :** Une note posée soit en haut du dossier (consignes de départ), soit sur le bureau à chaque réunion (avant chaque tour).

---

### Skill tiers — nano / micro / standard / extended (tailles de compétence)
**C'est quoi ?** Une même compétence existe en plusieurs **tailles**, du plus court au plus complet :
- **nano** : juste le rôle en une phrase.
- **micro** : le rôle + 3 à 5 règles clés.
- **standard** : la compétence complète.
- **extended** : complète + exemples détaillés.

**Pourquoi faire ?** S'il reste peu de place (de tokens), lemura met la version courte plutôt que de tout supprimer. Comme une notice : version « démarrage rapide » si on est pressé, manuel complet si on a le temps.

---

### Progressive skills / load_skill (compétences à la demande)
**C'est quoi ?** Plutôt que de charger toutes les compétences d'avance, on présente à l'IA un **menu** (« voici ce que je sais faire »). L'IA charge une compétence **seulement quand elle en a besoin**, via l'outil `load_skill`.

**Pourquoi faire ?** Économiser de la place et éviter de noyer l'IA. C'est la « divulgation progressive ».

**Illustration :** Un buffet plutôt qu'un menu imposé : on ne remplit son assiette qu'avec les plats dont on a envie sur le moment.

---

### Dynamic skills / tags (compétences activables)
**C'est quoi ?** Des compétences en réserve qu'on **active à la demande**, soit par leur nom, soit par étiquette (« tag »). Par exemple activer toutes les compétences marquées « finance ».

**Illustration :** Des badges d'accès : on n'ouvre certaines portes que lorsqu'on présente le bon badge.

---

## Le pilotage fin

### MetaRouter / Routing (aiguilleur)
**C'est quoi ?** Au début de chaque message, un « aiguilleur » regarde la demande et décide : est-ce une **simple discussion** (`chat`) ou une **vraie tâche** (`task`) ? Et quels groupes d'outils sont utiles ? Les outils inutiles sont **cachés** pour ce tour.

**Pourquoi faire ?** Moins d'outils visibles = IA moins confuse, plus rapide et moins chère. C'est l'aiguilleur de gare qui n'ouvre que la bonne voie selon le train.

---

### Tool category (catégorie d'outils)
**C'est quoi ?** Un regroupement d'outils par thème (« météo », « agenda », « fichiers »), pour que l'aiguilleur n'expose que les bonnes familles.

**Illustration :** Les rayons d'un supermarché : on va directement au rayon « frais » sans parcourir tout le magasin.

---

### Tool response compression / evaluation (tri des résultats d'outils)
**C'est quoi ?** Quand un outil renvoie **beaucoup** de texte, lemura évalue le résultat et ne garde que l'essentiel : a-t-il répondu à la question ? Est-ce trop long ? Y a-t-il une erreur cachée ?

**Pourquoi faire ?** Ne pas saturer la mémoire de travail avec un pavé alors que seules 3 lignes étaient utiles. Comme un assistant qui vous résume un rapport de 40 pages en un paragraphe pertinent.

---

### Loop detection (détection de boucle)
**C'est quoi ?** Un garde-fou qui repère si l'agent **se répète** (même action, mêmes arguments, encore et encore) et l'arrête avant qu'il ne tourne en rond indéfiniment.

**Illustration :** Un GPS qui détecte qu'il vous fait tourner trois fois autour du même rond-point et finit par dire « stop, recalculons ».

---

### finishReason (raison d'arrêt)
**C'est quoi ?** L'étiquette qui dit **pourquoi** l'IA a arrêté de parler : a-t-elle fini (`stop`), veut-elle utiliser un outil (`tool_call`), a-t-elle atteint sa limite de longueur (`max_tokens`), ou y a-t-il eu une erreur (`error`) ?

**Pourquoi faire ?** Savoir quoi faire ensuite. « Fini » → on rend la réponse ; « veut un outil » → on lance l'outil ; « limite atteinte » → on l'aide à conclure.

---

### Streaming (réponse au fil de l'eau)
**C'est quoi ?** Afficher la réponse **mot à mot, en direct**, au lieu d'attendre qu'elle soit entièrement écrite.

**Illustration :** Voir quelqu'un écrire sa lettre sous vos yeux, plutôt que de recevoir l'enveloppe scellée à la fin. C'est ce qui donne l'effet « l'IA tape en temps réel ».

---

### Trace event / observabilité
**C'est quoi ?** Un journal de bord détaillé de ce que fait l'agent : quelle réflexion, quel outil appelé, combien de temps, quelle erreur. On peut s'y abonner pour tout suivre.

**Pourquoi faire ?** Comprendre et déboguer. C'est la **boîte noire** d'un avion : si quelque chose cloche, on rejoue l'enregistrement pour voir ce qui s'est passé.

---

## Aspects techniques de réglage

### SessionManager (le chef d'orchestre)
**C'est quoi ?** Le point d'entrée principal. C'est lui qui orchestre tout : la mémoire, les outils, les compétences, la boucle de l'agent. On lui parle avec `run()` (pose une question, reçois la réponse) ou `stream()` (réponse au fil de l'eau).

**Illustration :** Le chef d'orchestre : il ne joue d'aucun instrument lui-même, mais c'est lui qui fait jouer tout le monde ensemble, au bon moment.

---

### SessionConfig (la fiche de réglages)
**C'est quoi ?** Le formulaire de configuration de l'agent : quel fournisseur d'IA, quel modèle, quelles limites, quels outils, quelle mémoire… Tout se règle là, au démarrage.

**Illustration :** Le tableau de bord d'une voiture neuve qu'on personnalise : sièges, rétros, limites de vitesse, avant de prendre la route.

---

### Static system prompt (consigne figée)
**C'est quoi ?** Une option qui garde les consignes de base **strictement identiques** à chaque tour, pour que l'IA puisse « réutiliser » son travail de réflexion précédent au lieu de tout recalculer.

**Pourquoi faire ?** Plus rapide et moins cher sur les longues tâches. C'est comme garder la même page de garde d'un dossier : inutile de la réimprimer à chaque fois.

---

### maxCompletionTokens vs maxTokens
**C'est quoi ?** Deux limites différentes :
- **maxTokens** : la taille totale de la mémoire de travail (le « bureau »).
- **maxCompletionTokens** : la longueur maximale d'**une seule réponse** que l'IA écrit d'un coup.

**Illustration :** `maxTokens` = la taille de votre cahier ; `maxCompletionTokens` = le nombre de lignes que vous vous autorisez pour une seule réponse.

---

> 💡 **En résumé** : lemura assemble un **agent** qui *raisonne et agit en boucle* ([ReAct](#react-boucle-reason--act)), garde un **cap** ([Goal](#goal--objectif)), se branche à des **outils** et des **services** ([MCP](#mcp--model-context-protocol), [RAG](#rag--retrieval-augmented-generation)), gère sa **mémoire** à plusieurs niveaux, s'appuie sur des **compétences** ([Skills](#skill-compétence)), et reste **sûr et maîtrisé** (pare-feu, budgets, vérification).
