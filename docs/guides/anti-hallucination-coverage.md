# Anti-hallucination : couverture des 8 couches dans lemura

> Audit du code de lemura face à l'architecture anti-hallucination en 8 couches
> pour les agents à petits modèles (SLM). Date : 2026-06-19.

## Le principe

Sur les tâches à vérité-terrain, **le SLM oriente, l'outil fait foi.** L'hallucination
apparaît quand on laisse le modèle *répondre* au lieu de *router et formater*. lemura
respecte ce principe au niveau de sa boucle ReAct (seuls les appels d'outils structurés
réellement émis sont exécutés, et l'observation réelle est réinjectée), mais ne couvre
nativement que 3 des 8 couches. Les autres sont applicatives ou absentes.

## Tableau de couverture

| # | Couche | Statut | Détail |
|---|---|---|---|
| 1 | **Ancrage strict** (vérité = outil) | 🟡 Mécanisme oui, consigne non | Le retour d'outil est injecté comme observation `tool` ; une erreur d'API remonte comme `Error:` et n'est jamais « comblée » par le modèle. Mais la consigne « réponds uniquement à partir de ces données, sinon dis je ne sais pas » n'est pas imposée — à mettre dans le `systemPrompt` ou un skill. |
| 2 | **Décodage contraint** (GBNF/Outlines/grammar) | 🔴 Absent | Aucun support grammaire / JSON-schema enforcement / `tool_choice` / guided decoding. lemura valide *après coup* (couche 3) mais n'empêche pas physiquement une émission invalide. Manque le plus structurel pour un SLM. |
| 3 | **Tool Firewall** (deny-by-default + validation) | 🟡 Type oui, sémantique non | `ToolFirewall` : `defaultDecision: 'ask'` fail-safe, règles regex nom+args ; validation **de type** via `SchemaValidator`. Pas de retry de réparation, **aucune validation sémantique** (mail existe ? date future ? ville résolvable ?). |
| 4 | **Extraction déterministe** (dateparser/libphonenumber) | 🔴 Absent | Aucun outil `resolve_datetime`/`parse_phone`/`calculator`. Politique zéro-dépendance → ces parseurs vivent côté application, exposés comme `IToolDefinition`. lemura fournit le contrat, pas les parseurs. |
| 5 | **Résolution d'entités** sur base réelle | 🔴 Absent du cœur | Aucun lookup contacts/référentiel. Applicatif — outil `lookup_contact` + étape de plan « si ambigu → ask ». |
| 6 | **Confirmation obligatoire** (actions irréversibles) | 🟢 Oui | Hook `onAsk` du firewall : décision `ask` → handler `(toolName, argsJson)` → fail-safe (seul un accept explicite passe). Étagement lecture/réversible/irréversible via les `rules`. |
| 7 | **Synthèse ancrée + abstention** (NLI / 2e passe) | 🔴 Absent | Pas de vérification de groundedness ni d'étape NLI. Le pattern est faisable (lemura fait déjà des appels temp-0 type `GoalVerifier`), mais aucun composant dédié. |
| 8 | **Spécialisation par fine-tuning** | ⚪ Hors scope | Ressort du modèle/MLOps. lemura est provider-agnostique : on y branche le SLM fine-tuné via l'adaptateur. |

### Réglages transverses

| Réglage | Statut | Détail |
|---|---|---|
| Température basse pour routage/extraction | 🟡 Interne oui, politique non | Tous les appels système de lemura (router, goal-verifier, scorers, planning) sont déjà à `temperature: 0`. Mais la température des appels d'outil de l'agent vient du `CompletionRequest` du conscommateur — lemura ne force pas 0–0.3. |
| Discipline ReAct (n'exécuter que les appels réels) | 🟢 Oui | Cœur de la boucle. Rien de « raconté » par le modèle n'est exécuté. |
| Jeu d'éval + 4 métriques | 🔴 Absent | Aucun harnais (choix d'outil, remplissage de slots, taux d'ancrage, taux de fausse action). À construire séparément. |

## Synthèse en une phrase

> lemura nous donne **nativement** les couches 6 (confirmation via firewall `onAsk`),
> la discipline ReAct, et le temp-0 sur nos appels système. Il nous donne **le contrat
> mais pas le contenu** pour les couches 1, 3, 4 et 5 (à nous d'écrire les outils
> déterministes, la validation sémantique et la résolution d'entités côté app). Et il
> lui **manque structurellement** les couches 2 (décodage contraint — le plus critique
> pour un SLM) et 7 (synthèse ancrée / abstention), plus tout le volet mesure.

## Les 3 manques qui comptent

1. **Décodage contraint (couche 2)** — le plus impactant pour un petit modèle. À adresser au niveau de l'adaptateur (passer `response_format`/grammar à un endpoint qui le supporte : llama.cpp, vLLM guided).
2. **Validation sémantique dans le firewall (couche 3)** — aujourd'hui regex-only ; il faut un hook de validation async par outil.
3. **Synthèse ancrée + abstention (couche 7)** — à construire comme étape de vérification.

## Références code

- Boucle ReAct & confirmation : `src/agent/SessionManager.ts` (hook `onAsk` ~ligne 1085)
- Firewall : `src/tools/ToolFirewall.ts` ; types : `src/types/agent.ts` (`ToolFirewallConfig`, `ToolDecision`)
- Validation de type des arguments : `src/tools/SchemaValidator.ts`, `src/tools/ToolRegistry.ts`
- Appels système temp-0 : `src/agent/execution/Router.ts`, `src/memory/scorers/LLMReRankScorer.ts`
