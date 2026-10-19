package com.feelbachelor.doompedia.data.net

import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URLEncoder
import java.net.URL
import java.nio.charset.StandardCharsets

class WikipediaImageClient {
    fun fetchThumbnailUrl(language: String, pageId: Long, title: String, maxWidth: Int = 640): String? {
        val normalizedLang = language.ifBlank { "en" }
        val cleanedTitle = title.trim().replace(' ', '_')
        if (cleanedTitle.isBlank()) return null
        val thumbSize = maxWidth.coerceIn(160, 1280)

        // 1) Best-effort lookup by page id (most stable).
        val pageIdEndpoint = buildString {
            append("https://")
            append(normalizedLang)
            append(".wikipedia.org/w/api.php")
            append("?action=query&format=json&prop=pageimages")
            append("&piprop=thumbnail")
            append("&pithumbsize=")
            append(thumbSize)
            append("&pilicense=any")
            append("&pageids=")
            append(pageId)
        }

        // 2) Fallback lookup by title.
        val titleEndpoint = buildString {
            append("https://")
            append(normalizedLang)
            append(".wikipedia.org/w/api.php")
            append("?action=query&format=json&prop=pageimages")
            append("&piprop=thumbnail")
            append("&pithumbsize=")
            append(thumbSize)
            append("&pilicense=any")
            append("&titles=")
            append(URLEncoder.encode(cleanedTitle, StandardCharsets.UTF_8.name()))
        }

        val byPageId = runCatching { fetchJson(pageIdEndpoint) }
            .getOrNull()
            ?.let(::extractThumbnailSource)
            ?.let(::normalizeSourceUrl)
        if (!byPageId.isNullOrBlank()) {
            return byPageId
        }

        val byTitle = runCatching { fetchJson(titleEndpoint) }
            .getOrNull()
            ?.let(::extractThumbnailSource)
            ?.let(::normalizeSourceUrl)
        if (!byTitle.isNullOrBlank()) {
            return byTitle
        }

        // Fallback path: REST summary endpoint often has thumbnail where pageimages does not.
        val summaryEndpoint = buildString {
            append("https://")
            append(normalizedLang)
            append(".wikipedia.org/api/rest_v1/page/summary/")
            append(URLEncoder.encode(cleanedTitle, StandardCharsets.UTF_8.name()))
        }

        val fromSummary = runCatching {
            val payload = fetchJson(summaryEndpoint)
            val root = JSONObject(payload)
            val thumbnail = root.optJSONObject("thumbnail")
            val source = thumbnail?.optString("source").orEmpty().trim()
            normalizeSourceUrl(source)
        }.getOrNull()
        if (!fromSummary.isNullOrBlank()) {
            return fromSummary
        }

        // Last fallback: parse article HTML OpenGraph image tag.
        return runCatching {
            fetchOpenGraphImage(normalizedLang, cleanedTitle)
        }.getOrNull()
    }

    private fun fetchJson(url: String): String {
        return fetchRaw(url = url, accept = "application/json")
    }

    private fun fetchOpenGraphImage(language: String, cleanedTitle: String): String? {
        val articleUrl = buildString {
            append("https://")
            append(language)
            append(".wikipedia.org/wiki/")
            append(URLEncoder.encode(cleanedTitle, StandardCharsets.UTF_8.name()))
        }
        val html = fetchRaw(url = articleUrl, accept = "text/html")
        val match = OPEN_GRAPH_IMAGE_REGEX.find(html) ?: return null
        return normalizeSourceUrl(match.groupValues.getOrNull(1))
    }

    private fun fetchRaw(url: String, accept: String): String {
        val connection = (URL(url).openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            connectTimeout = 10_000
            readTimeout = 12_000
            setRequestProperty("Accept", accept)
            setRequestProperty("User-Agent", "Doompedia/0.1 (+https://github.com/elephancy/doompedia)")
        }

        return connection.use { conn ->
            val statusCode = conn.responseCode
            val body = if (statusCode in 200..299) conn.inputStream else (conn.errorStream ?: conn.inputStream)
            val text = body.bufferedReader().use { it.readText() }
            require(statusCode in 200..299) { "Wikipedia image API error $statusCode" }
            text
        }
    }

    private fun extractThumbnailSource(payload: String): String? {
        val root = JSONObject(payload)
        val pages = root.optJSONObject("query")?.optJSONObject("pages") ?: JSONObject()
        val keys = pages.keys()
        while (keys.hasNext()) {
            val key = keys.next()
            val page = pages.optJSONObject(key) ?: continue
            val thumbnail = page.optJSONObject("thumbnail") ?: continue
            val source = thumbnail.optString("source").trim()
            if (source.isNotBlank()) {
                return source
            }
        }
        return null
    }

    private fun normalizeSourceUrl(source: String?): String? {
        val trimmed = source.orEmpty().trim()
        if (trimmed.isBlank()) return null
        return if (trimmed.startsWith("//")) {
            "https:$trimmed"
        } else {
            trimmed
        }
    }
}

private val OPEN_GRAPH_IMAGE_REGEX = Regex(
    pattern = """<meta\s+property=["']og:image["']\s+content=["']([^"']+)["']""",
    options = setOf(RegexOption.IGNORE_CASE),
)

private inline fun <T> HttpURLConnection.use(block: (HttpURLConnection) -> T): T {
    return try {
        block(this)
    } finally {
        disconnect()
    }
}
