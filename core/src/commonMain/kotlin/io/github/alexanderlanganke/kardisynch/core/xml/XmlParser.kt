package io.github.alexanderlanganke.kardisynch.core.xml

/**
 * A parsed XML element: local name (namespace prefix stripped — matches the
 * Electron parsers' fast-xml-parser `transformTagName` behavior of dropping
 * everything before the first ':'), attributes, child elements, and any
 * direct text content.
 */
data class XmlNode(
    val name: String,
    val attributes: Map<String, String> = emptyMap(),
    val children: List<XmlNode> = emptyList(),
    val text: String = "",
) {
    /** First direct child with this local name, or null. */
    fun child(name: String): XmlNode? = children.firstOrNull { it.name == name }

    /** All direct children with this local name, in document order. */
    fun childrenNamed(name: String): List<XmlNode> = children.filter { it.name == name }
}

class XmlParseException(message: String) : Exception(message)

/**
 * Minimal, dependency-free XML parser (no JVM/platform APIs — pure
 * commonMain string scanning). Covers what the ported manufacturer exports
 * actually use: elements, attributes, text content, comments, processing
 * instructions, CDATA, standard entities. No DTD support — none of the real
 * samples ported so far need it.
 */
object XmlParser {
    fun parse(xml: String): XmlNode {
        val p = Parser(xml)
        p.skipProlog()
        return p.parseElement() ?: throw XmlParseException("No root element found")
    }

    private class Parser(private val s: String) {
        var i = 0

        fun skipWhitespace() {
            while (i < s.length && s[i].isWhitespace()) i++
        }

        fun matches(token: String): Boolean = i + token.length <= s.length && s.regionMatches(i, token, 0, token.length)

        fun skipComment() {
            val end = s.indexOf("-->", i)
            if (end == -1) throw XmlParseException("Unterminated comment")
            i = end + 3
        }

        fun skipProlog() {
            while (true) {
                skipWhitespace()
                when {
                    matches("<?") -> {
                        val end = s.indexOf("?>", i)
                        if (end == -1) throw XmlParseException("Unterminated processing instruction")
                        i = end + 2
                    }
                    matches("<!--") -> skipComment()
                    else -> return
                }
            }
        }

        /** Parses one element (and its subtree) starting at '<', or null if none found. */
        fun parseElement(): XmlNode? {
            skipWhitespace()
            while (matches("<!--")) {
                skipComment()
                skipWhitespace()
            }
            if (i >= s.length || s[i] != '<') return null
            i++ // consume '<'
            val name = stripNamespace(readName())
            val attributes = mutableMapOf<String, String>()

            while (true) {
                skipWhitespace()
                if (matches("/>")) {
                    i += 2
                    return XmlNode(name, attributes, emptyList(), "")
                }
                if (matches(">")) {
                    i++
                    break
                }
                val attrRawName = readName()
                skipWhitespace()
                if (i >= s.length || s[i] != '=') throw XmlParseException("Expected '=' after attribute '$attrRawName' in <$name>")
                i++
                skipWhitespace()
                val quote = s.getOrNull(i)
                if (quote != '"' && quote != '\'') throw XmlParseException("Expected quoted attribute value for '$attrRawName' in <$name>")
                i++
                val valueStart = i
                while (i < s.length && s[i] != quote) i++
                val rawValue = s.substring(valueStart, i)
                i++ // closing quote
                attributes[stripNamespace(attrRawName)] = decodeEntities(rawValue)
            }

            val children = mutableListOf<XmlNode>()
            val textBuilder = StringBuilder()
            while (true) {
                if (i >= s.length) throw XmlParseException("Unterminated element <$name>")
                when {
                    matches("</") -> {
                        i += 2
                        val closeName = stripNamespace(readName())
                        skipWhitespace()
                        if (i >= s.length || s[i] != '>') throw XmlParseException("Malformed closing tag for <$name>")
                        i++
                        if (closeName != name) {
                            throw XmlParseException("Mismatched closing tag: expected </$name>, found </$closeName>")
                        }
                        return XmlNode(name, attributes, children, textBuilder.toString().trim())
                    }
                    matches("<!--") -> skipComment()
                    matches("<![CDATA[") -> {
                        val end = s.indexOf("]]>", i)
                        if (end == -1) throw XmlParseException("Unterminated CDATA section in <$name>")
                        textBuilder.append(s, i + 9, end)
                        i = end + 3
                    }
                    s[i] == '<' -> {
                        val child = parseElement() ?: throw XmlParseException("Malformed child element inside <$name>")
                        children.add(child)
                    }
                    else -> {
                        val textStart = i
                        while (i < s.length && s[i] != '<') i++
                        textBuilder.append(decodeEntities(s.substring(textStart, i)))
                    }
                }
            }
        }

        fun readName(): String {
            val start = i
            while (i < s.length && !s[i].isWhitespace() && s[i] != '>' && s[i] != '/' && s[i] != '=') i++
            if (i == start) throw XmlParseException("Expected a name at position $i")
            return s.substring(start, i)
        }
    }
}

private fun stripNamespace(rawName: String): String {
    val idx = rawName.indexOf(':')
    return if (idx >= 0) rawName.substring(idx + 1) else rawName
}

private fun decodeEntities(raw: String): String {
    if (!raw.contains('&')) return raw
    val sb = StringBuilder(raw.length)
    var i = 0
    while (i < raw.length) {
        val c = raw[i]
        if (c == '&') {
            val semi = raw.indexOf(';', i)
            if (semi != -1) {
                val entity = raw.substring(i + 1, semi)
                val decoded = decodeEntity(entity)
                if (decoded != null) {
                    sb.append(decoded)
                    i = semi + 1
                    continue
                }
            }
        }
        sb.append(c)
        i++
    }
    return sb.toString()
}

private fun decodeEntity(entity: String): String? = when {
    entity == "amp" -> "&"
    entity == "lt" -> "<"
    entity == "gt" -> ">"
    entity == "quot" -> "\""
    entity == "apos" -> "'"
    entity.startsWith("#x") || entity.startsWith("#X") ->
        entity.substring(2).toIntOrNull(16)?.let(::codepointToString)
    entity.startsWith("#") ->
        entity.substring(1).toIntOrNull()?.let(::codepointToString)
    else -> null
}

private fun codepointToString(codepoint: Int): String {
    if (codepoint <= 0xFFFF) return codepoint.toChar().toString()
    // Surrogate pair for values outside the Basic Multilingual Plane.
    val cp = codepoint - 0x10000
    val high = (cp shr 10) + 0xD800
    val low = (cp and 0x3FF) + 0xDC00
    return charArrayOf(high.toChar(), low.toChar()).concatToString()
}
