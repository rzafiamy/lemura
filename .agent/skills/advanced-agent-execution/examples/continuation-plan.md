# Example: Continuation Plan for a Multi-Step Research Agent

This example shows a `ContinuationPlan` for a goal that requires:
1. Searching for documents
2. Extracting entities from results (depends on step 1)
3. Cross-referencing entities against a database (depends on step 2)
4. Generating a final report (depends on step 3)

## Initial plan (generated at session start)

```json
{
  "steps": [
    {
      "stepId": "search",
      "toolName": "rag_query",
      "description": "Search for documents about climate policy 2024",
      "dependsOn": [],
      "status": "pending",
      "outputKey": "searchResults"
    },
    {
      "stepId": "extract",
      "toolName": "extract_entities",
      "description": "Extract country names and policy names from search results",
      "dependsOn": ["search"],
      "status": "pending",
      "outputKey": "entities",
      "inputMapping": { "text": "searchResults.content" }
    },
    {
      "stepId": "crossref",
      "toolName": "database_lookup",
      "description": "Cross-reference extracted countries against emissions database",
      "dependsOn": ["extract"],
      "status": "pending",
      "outputKey": "crossRefData",
      "inputMapping": { "countries": "entities.countries" }
    },
    {
      "stepId": "report",
      "toolName": "generate_report",
      "description": "Generate final comparative report",
      "dependsOn": ["crossref"],
      "status": "pending",
      "inputMapping": {
        "entities": "entities",
        "data": "crossRefData",
        "sources": "searchResults.sources"
      }
    }
  ],
  "currentStepIndex": 0,
  "strategy": "sequential"
}
```

## Plan status injection after step 1 completes

```
[CONTINUATION PLAN — Step 2/4]
✅ Step 1 (rag_query): Done — found 8 documents
▶  Step 2 (extract_entities): Running
⏳ Step 3 (database_lookup): Waiting on Step 2
⏳ Step 4 (generate_report): Waiting on Step 3
```

## Plan status injection after step 2 fails

```
[CONTINUATION PLAN — Step 3/4]
✅ Step 1 (rag_query): Done
❌ Step 2 (extract_entities): Failed — API timeout after 30s
⏭  Step 3 (database_lookup): Skipped (depends on failed Step 2)
⏭  Step 4 (generate_report): Skipped (depends on failed Step 3)
```

Final response would show:
- Goal Status: PARTIALLY_ACHIEVED
- Accomplished: Document search (8 documents found)
- Failed: extract_entities (timeout), database_lookup (skipped), generate_report (skipped)