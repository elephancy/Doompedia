import Foundation

struct OnlineArticle {
    let pageID: Int64
    let lang: String
    let title: String
    let summary: String
    let wikiURL: String
    let sourceRevID: Int64?
    let updatedAt: String
}

final class WikipediaAPIClient {
    private let session: URLSession

    init(session: URLSession = .shared) {
        self.session = session
    }

    func fetchRandomSummaries(language: String, count: Int) async throws -> [OnlineArticle] {
        let target = max(1, min(count, 40))
        var articles: [OnlineArticle] = []
        var seenTitles = Set<String>()
        let seed = Int(Date().timeIntervalSince1970 * 1000)

        for index in 0 ..< (target * 4) {
            if articles.count >= target { break }
            guard let url = URL(string: "https://\(language).wikipedia.org/api/rest_v1/page/random/summary?cb=\(seed + index)") else {
                break
            }
            let request = makeRequest(url: url)
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
                continue
            }

            guard
                let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                let title = payload["title"] as? String,
                let extract = payload["extract"] as? String,
                let page = payload["content_urls"] as? [String: Any],
                let desktop = page["desktop"] as? [String: Any],
                let pageURL = desktop["page"] as? String
            else {
                continue
            }

            if !seenTitles.insert(title).inserted { continue }

            let pageID = (payload["pageid"] as? NSNumber)?.int64Value ?? stablePageID(from: title)
            let timestamp = (payload["timestamp"] as? String) ?? ISO8601DateFormatter().string(from: Date())
            let revID = (payload["revision"] as? NSNumber)?.int64Value
            articles.append(
                OnlineArticle(
                    pageID: pageID,
                    lang: language,
                    title: title,
                    summary: extract,
                    wikiURL: pageURL,
                    sourceRevID: revID,
                    updatedAt: timestamp
                )
            )
        }

        return articles
    }

    func searchTitles(language: String, query: String, limit: Int) async throws -> [OnlineArticle] {
        let cleaned = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return [] }
        let safeLimit = max(1, min(limit, 50))

        var components = URLComponents(string: "https://\(language).wikipedia.org/w/api.php")!
        components.queryItems = [
            URLQueryItem(name: "action", value: "opensearch"),
            URLQueryItem(name: "search", value: cleaned),
            URLQueryItem(name: "limit", value: "\(safeLimit)"),
            URLQueryItem(name: "namespace", value: "0"),
            URLQueryItem(name: "format", value: "json"),
            URLQueryItem(name: "formatversion", value: "2"),
        ]
        guard let url = components.url else { return [] }

        let request = makeRequest(url: url)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
            return []
        }

        guard let payload = try JSONSerialization.jsonObject(with: data) as? [Any],
              payload.count >= 4,
              let titles = payload[1] as? [String],
              let summaries = payload[2] as? [String],
              let urls = payload[3] as? [String]
        else {
            return []
        }

        let nowISO = ISO8601DateFormatter().string(from: Date())
        var output: [OnlineArticle] = []
        for index in titles.indices {
            let title = titles[index]
            guard index < urls.count else { continue }
            output.append(
                OnlineArticle(
                    pageID: stablePageID(from: title),
                    lang: language,
                    title: title,
                    summary: index < summaries.count ? summaries[index] : "",
                    wikiURL: urls[index],
                    sourceRevID: nil,
                    updatedAt: nowISO
                )
            )
        }
        return output
    }

    func fetchThumbnailURL(language: String, title: String, maxWidth: Int = 640) async throws -> String? {
        let cleaned = title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleaned.isEmpty else { return nil }

        var components = URLComponents(string: "https://\(language).wikipedia.org/w/api.php")!
        components.queryItems = [
            URLQueryItem(name: "action", value: "query"),
            URLQueryItem(name: "format", value: "json"),
            URLQueryItem(name: "prop", value: "pageimages"),
            URLQueryItem(name: "piprop", value: "thumbnail"),
            URLQueryItem(name: "pithumbsize", value: "\(max(160, min(maxWidth, 1280)))"),
            URLQueryItem(name: "pilicense", value: "any"),
            URLQueryItem(name: "titles", value: cleaned),
        ]
        guard let url = components.url else { return nil }

        let request = makeRequest(url: url)
        let (data, response) = try await session.data(for: request)
        guard let http = response as? HTTPURLResponse, (200 ... 299).contains(http.statusCode) else {
            return nil
        }

        guard
            let payload = try JSONSerialization.jsonObject(with: data) as? [String: Any],
            let query = payload["query"] as? [String: Any],
            let pages = query["pages"] as? [String: Any]
        else {
            return nil
        }

        for (_, value) in pages {
            guard let page = value as? [String: Any],
                  let thumbnail = page["thumbnail"] as? [String: Any],
                  let source = thumbnail["source"] as? String,
                  !source.isEmpty
            else {
                continue
            }
            return source
        }
        return nil
    }

    private func makeRequest(url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.timeoutInterval = 20
        request.setValue("Doompedia/0.1 (+https://github.com/elephancy/doompedia)", forHTTPHeaderField: "User-Agent")
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        return request
    }

    private func stablePageID(from title: String) -> Int64 {
        var hash: UInt64 = 1469598103934665603
        for byte in title.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1099511628211
        }
        return Int64(bitPattern: hash & 0x7fff_ffff_ffff_ffff)
    }
}
