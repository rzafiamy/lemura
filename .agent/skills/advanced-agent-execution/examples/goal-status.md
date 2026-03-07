# Example: Final Response Formulations

Reference examples for all three `Goal Status` outcomes.
Agent should match this structure exactly in final response formulation.

---

## ACHIEVED example

```
## Goal Status: ACHIEVED

### What was accomplished
Located and summarized 3 relevant research papers on transformer attention mechanisms,
extracted the key findings from each, and cross-referenced them against the provided
reading list. All 5 requested papers were found and processed.

### Remaining tasks
None.

### Failed steps
None.

### Result
Here are the summaries of the 5 papers you requested:

**Paper 1 — "Attention Is All You Need" (Vaswani et al., 2017)**
Introduced the transformer architecture replacing recurrence with self-attention...

**Paper 2 — ...**
...
```

---

## PARTIALLY_ACHIEVED example

```
## Goal Status: PARTIALLY_ACHIEVED

### What was accomplished
- Successfully ingested 4 of 6 requested documents into the RAG index
- Generated embeddings and confirmed retrieval for all 4 ingested documents
- Ran a test query that returned relevant results from the ingested set

### Remaining tasks
- Document 5 (quarterly-report-q3.pdf): Upload failed — file not found at provided path
- Document 6 (board-minutes.docx): Upload failed — unsupported file format

### Failed steps
- rag_ingest (doc5): LemuraToolValidationError — file path "/uploads/q3.pdf" returned 404
- rag_ingest (doc6): LemuraAdapterError — CAPABILITY_NOT_SUPPORTED for .docx MIME type

### Result
The RAG index now contains 4 documents and is queryable. To complete the ingestion,
re-upload document 5 with the correct path, and convert document 6 to PDF or plain text
before re-ingesting.
```

---

## FAILED example

```
## Goal Status: FAILED

### What was accomplished
Successfully authenticated with the external API and retrieved the list of available
report types (3 types found).

### Remaining tasks
- Generate the monthly sales report: blocked by failed data fetch
- Email the report to the distribution list: blocked by report generation failure

### Failed steps
- fetch_sales_data: LemuraAdapterError — API returned HTTP 403 Forbidden.
  The API key provided does not have access to the "sales_aggregate" endpoint.
  Required permission: "reports:read". Current permissions: "reports:list".
- generate_report: Skipped (depends on failed fetch_sales_data)
- send_email: Skipped (depends on failed generate_report)

### Result
The task could not be completed due to insufficient API permissions.
To resolve: grant the "reports:read" permission to the API key, then retry.
```