package com.feelbachelor.doompedia.data.net

import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.nio.charset.StandardCharsets

data class OnlineArticle(
    val pageId: Long,
    val lang: String,
    val title: String,
    val summary: String,
    val wikiUrl: String,
    val sourceRevId: Long? = null,
    val updatedAt: String = "1970-01-01T00:00:00Z",
)

class WikipediaApiClient {
    fun fetchRandomSummaries(language: String, count: Int): List<OnlineArticle> {
        val normalizedLang = language.ifBlank { "en" }
        val cappedCount = count.coerceIn(1, 60)
        val seen = mutableSetOf<Long>()
        val results = mutableListOf<OnlineArticle>()
        val nowIso = java.time.Instant.now().toString()
        val cacheBustSeed = System.currentTimeMillis()

        repeat(cappedCount * 4) { attempt ->
            if (results.size >= cappedCount) return@repeat
            val endpoint = "https://$normalizedLang.wikipedia.org/api/rest_v1/page/random/summary?cb=${cacheBustSeed + attempt}"
            val payload = runCatching { fetchJson(endpoint) }.getOrNull() ?: return@repeat
            val parsed = parseRandomSummary(payload, normalizedLang, nowIso) ?: return@repeat
            if (!seen.add(parsed.pageId)) return@repeat
            results += parsed
        }

        if (results.isNotEmpty()) {
            return results
        }

        // Fallback for environments where REST random summary endpoint is blocked/unreliable.
        val queryFallback = runCatching {
            fetchRandomSummariesViaQueryApi(
                language = normalizedLang,
                count = cappedCount,
                nowIso = nowIso,
            )
        }.getOrDefault(emptyList())

        queryFallback.forEach { article ->
            if (results.size >= cappedCount) return@forEach
            if (seen.add(article.pageId)) {
                results += article
            }
        }

        if (results.isEmpty()) {
            val seededFallback = runCatching {
                fetchSeededFallback(language = normalizedLang, count = cappedCount)
            }.getOrDefault(emptyList())
            seededFallback.forEach { article ->
                if (results.size >= cappedCount) return@forEach
                if (seen.add(article.pageId)) {
                    results += article
                }
            }
        }
        return results
    }

    fun searchTitles(language: String, query: String, limit: Int): List<OnlineArticle> {
        val normalizedLang = language.ifBlank { "en" }
        val cleanedQuery = query.trim()
        if (cleanedQuery.isBlank()) return emptyList()

        val cappedLimit = limit.coerceIn(1, 50)
        val nowIso = java.time.Instant.now().toString()
        val encodedQuery = URLEncoder.encode(cleanedQuery, StandardCharsets.UTF_8.name())
        val endpoint = "https://$normalizedLang.wikipedia.org/w/api.php" +
            "?action=opensearch&search=$encodedQuery&limit=$cappedLimit&namespace=0&format=json"

        val json = JSONArray(fetchJson(endpoint))
        val titles = json.optJSONArray(1) ?: JSONArray()
        val descriptions = json.optJSONArray(2) ?: JSONArray()
        val urls = json.optJSONArray(3) ?: JSONArray()

        val results = mutableListOf<OnlineArticle>()
        for (index in 0 until titles.length()) {
            val title = titles.optString(index).trim()
            if (title.isBlank()) continue
            val summary = descriptions.optString(index).trim().ifBlank { "$title article on Wikipedia" }
            val wikiUrl = urls.optString(index).trim().ifBlank {
                "https://$normalizedLang.wikipedia.org/wiki/" + URLEncoder.encode(
                    title.replace(' ', '_'),
                    StandardCharsets.UTF_8.name(),
                )
            }
            val pageId = stableSyntheticPageId(language = normalizedLang, title = title)
            results += OnlineArticle(
                pageId = pageId,
                lang = normalizedLang,
                title = title,
                summary = summary,
                wikiUrl = wikiUrl,
                sourceRevId = null,
                updatedAt = nowIso,
            )
        }
        return results
    }

    private fun parseRandomSummary(payload: String, language: String, nowIso: String): OnlineArticle? {
        val json = JSONObject(payload)
        val title = json.optString("title").trim()
        if (title.isBlank()) return null
        val summary = json.optString("extract").trim()
            .ifBlank { "$title article on Wikipedia" }

        val pageId = json.optLong("pageid", -1L).takeIf { it > 0L }
            ?: stableSyntheticPageId(language = language, title = title)

        val urls = json.optJSONObject("content_urls")
        val wikiUrl = urls?.optJSONObject("desktop")?.optString("page").orEmpty()
            .ifBlank { urls?.optJSONObject("mobile")?.optString("page").orEmpty() }
            .ifBlank {
            json.optString("canonicalurl").ifBlank {
                "https://$language.wikipedia.org/wiki/" + URLEncoder.encode(
                    title.replace(' ', '_'),
                    StandardCharsets.UTF_8.name(),
                )
            }
        }

        return OnlineArticle(
            pageId = pageId,
            lang = language,
            title = title,
            summary = summary,
            wikiUrl = wikiUrl,
            sourceRevId = null,
            updatedAt = nowIso,
        )
    }

    private fun fetchRandomSummariesViaQueryApi(
        language: String,
        count: Int,
        nowIso: String,
    ): List<OnlineArticle> {
        val endpoint = "https://$language.wikipedia.org/w/api.php" +
            "?action=query&format=json&generator=random&grnnamespace=0&grnlimit=${count.coerceIn(1, 50)}" +
            "&prop=extracts|info&inprop=url&explaintext=1&exintro=1&exchars=420"

        val root = JSONObject(fetchJson(endpoint))
        val pages = root.optJSONObject("query")?.optJSONObject("pages") ?: JSONObject()
        val keys = pages.keys()
        val rows = mutableListOf<OnlineArticle>()
        while (keys.hasNext()) {
            val key = keys.next()
            val page = pages.optJSONObject(key) ?: continue
            val pageId = page.optLong("pageid", -1L)
            if (pageId <= 0L) continue
            val title = page.optString("title").trim()
            if (title.isBlank()) continue
            val summary = page.optString("extract").trim().ifBlank { "$title article on Wikipedia" }
            val wikiUrl = page.optString("fullurl").trim().ifBlank {
                "https://$language.wikipedia.org/wiki/" + URLEncoder.encode(
                    title.replace(' ', '_'),
                    StandardCharsets.UTF_8.name(),
                )
            }
            rows += OnlineArticle(
                pageId = pageId,
                lang = language,
                title = title,
                summary = summary,
                wikiUrl = wikiUrl,
                sourceRevId = null,
                updatedAt = nowIso,
            )
        }
        return rows
    }

    private fun fetchSeededFallback(
        language: String,
        count: Int,
    ): List<OnlineArticle> {
        val queries = listOf(
            "science",
            "history",
            "technology",
            "mathematics",
            "biology",
            "space",
            "culture",
            "geography",
            "engineering",
            "art",
        )
        val seen = mutableSetOf<Long>()
        val rows = mutableListOf<OnlineArticle>()
        for (query in queries) {
            if (rows.size >= count) break
            val chunk = searchTitles(
                language = language,
                query = query,
                limit = (count - rows.size).coerceIn(1, 10),
            )
            chunk.forEach { article ->
                if (rows.size >= count) return@forEach
                if (seen.add(article.pageId)) {
                    rows += article
                }
            }
        }
        return rows
    }

    private fun fetchJson(url: String): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 12_000
            setRequestProperty("Accept", "application/json")
            setRequestProperty("User-Agent", "Doompedia/0.1 (+https://github.com/elephancy/doompedia)")
        }
        return connection.use { conn ->
            val statusCode = conn.responseCode
            val body = if (statusCode in 200..299) {
                conn.inputStream
            } else {
                conn.errorStream ?: conn.inputStream
            }
            val text = body.bufferedReader().use(BufferedReader::readText)
            require(statusCode in 200..299) {
                "Wikipedia API error $statusCode"
            }
            text
        }
    }

    private fun stableSyntheticPageId(language: String, title: String): Long {
        val key = "$language:${title.lowercase()}"
        val hash = key.hashCode().toLong().and(0x7FFF_FFFFL)
        return 9_000_000_000L + hash
    }
}

private inline fun <T> HttpURLConnection.use(block: (HttpURLConnection) -> T): T {
    return try {
        block(this)
    } finally {
        disconnect()
    }
}
