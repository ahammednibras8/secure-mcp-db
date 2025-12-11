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

    // libpg_query invocation
    char *json = NULL;

#if defined(HAS_PG_QUERY_PARSE_TO_JSON)
    json = pg_query_parse_to_json(query);
#else
    json = duplicate_cstring("{\"error\":\"libpg_query_json_not_available_in_bridge_stub\"}");
#endif

    free(query);

    if (!json)
    {
        return duplicate_cstring("{\"error\":\"parse_failed_or_null\"}");
    }

    char *ret = duplicate_cstring(json);

#if defined(HAS_PG_QUERY_PARSE_TO_JSON) && defined(PG_QUERY_NEEDS_FREE)
    pg_query_free_json(json);
#endif

    return ret;
}

EXPORT
void free_result(char *ptr)
{
    if (ptr)
        free(ptr);
}