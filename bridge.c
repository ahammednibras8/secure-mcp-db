#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#include "pg_query.h"

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#define EXPORT EMSCRIPTEN_KEEPALIVE
#else
#define EXPORT
#endif

// Helper: duplicate a C string into malloc'd memory to return to caller
static char *duplicate_cstring(const char *s)
{
    if (s == NULL)
        return NULL;
    size_t n = strlen(s);
    char *out = (char *)malloc(n + 1);
    if (!out)
        return NULL;
    memcpy(out, s, n + 1);
    return out;
}

// Parse SQL and return JSON string pointer (caller must free via free_result)
EXPORT
char *parse_sql(const char *sql_ptr, int len)
{
    if (!sql_ptr || len <= 0)
    {
        const char *err = "{\"error\":\"empty_sql\"}";
        return duplicate_cstring(err);
    }

    // Create a null-terminated copy (libpg_query expects C string)
    char *query = (char *)malloc((size_t)len + 1);
    if (!query)
    {
        return duplicate_cstring("{\"error\":\"alloc_failed\"}");
    }
    memcpy(query, sql_ptr, (size_t)len);
    query[len] = '\0';

    // ----------- libpg_query invocation -----------
    PgQueryParseResult result = pg_query_parse(query);

    char* json = NULL;
    if (result.error) {
        // Return error as JSON (simple formatting)
        // You might want to format this better with robust JSON escaping if needed,
        // but for now we'll return a simple error object.
        // We'll just return the message for simplicity or specific error json.
        // To be safe and simple:
        const char* fmt = "{\"error\":\"%s\",\"cursorpos\":%d}";
        // minimal safety check on message length or just use a safe buffer
        // For a bridge, let's keep it simple.
        // Note: result.error->message is a C string.
        
        // Let's just return NULL for now or a generic error if we can't easily format strict JSON safely in C without deps.
        // However, we can just return the raw string if the caller expects it, or try to format.
        // Let's rely on valid JSON return.
        
        // Actually, let's just duplicate the message if we want, or better:
        // Use a static error string for "parse_error" and maybe append details if needed.
        // But the previous code expected a JSON string.
        // Let's try to pass the error message simply.
        // For this iteration, let's duplicate the error message directly if it exists, 
        // OR return a JSON with error.
        
        // NOTE: Simplest valid JSON for error:
        json = duplicate_cstring("{\"error\":\"SQL parse error\"}");
    } else {
        json = duplicate_cstring(result.parse_tree);
    }

    pg_query_free_parse_result(result);

    free(query);

    if (!json) {
        return duplicate_cstring("{\"error\":\"parse_known_error\"}");
    }

    return json;
}

EXPORT
void free_result(char *ptr)
{
    if (ptr)
        free(ptr);
}