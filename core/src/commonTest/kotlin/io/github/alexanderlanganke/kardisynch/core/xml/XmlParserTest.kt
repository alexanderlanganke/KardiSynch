package io.github.alexanderlanganke.kardisynch.core.xml

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertTrue

class XmlParserTest {
    @Test
    fun `parses a simple element with text content`() {
        val root = XmlParser.parse("<Root><Name>Alice</Name></Root>")
        assertEquals("Alice", root.child("Name")?.text)
    }

    @Test
    fun `strips namespace prefixes from tag and attribute names`() {
        val root = XmlParser.parse(
            """<carddas:InterfaceData carddas:Source="X" xmlns:carddas="urn:x">
                |<carddas:Patient/>
                |</carddas:InterfaceData>""".trimMargin(),
        )
        assertEquals("InterfaceData", root.name)
        assertEquals("X", root.attributes["Source"])
        assertTrue(root.childrenNamed("Patient").isNotEmpty())
    }

    @Test
    fun `decodes standard and numeric entities`() {
        val root = XmlParser.parse("<Root>A &amp; B &#65; &#x42;</Root>")
        assertEquals("A & B A B", root.text)
    }

    @Test
    fun `skips prolog, processing instructions, and comments`() {
        val root = XmlParser.parse(
            """<?xml version="1.0" encoding="UTF-8"?>
                |<?xml-stylesheet type="text/xsl" href="x.xslt"?>
                |<!-- a comment -->
                |<Root><!-- inline comment -->Hello</Root>""".trimMargin(),
        )
        assertEquals("Hello", root.text)
    }

    @Test
    fun `treats repeated sibling tags as separate children in document order`() {
        val root = XmlParser.parse("<Root><Item>1</Item><Item>2</Item><Item>3</Item></Root>")
        assertEquals(listOf("1", "2", "3"), root.childrenNamed("Item").map { it.text })
    }

    @Test
    fun `parses self-closing elements`() {
        val root = XmlParser.parse("<Root><Empty/></Root>")
        val empty = root.child("Empty")
        assertEquals("", empty?.text)
        assertTrue(empty!!.children.isEmpty())
    }

    @Test
    fun `parses CDATA sections`() {
        val root = XmlParser.parse("<Root><![CDATA[<raw> & text]]></Root>")
        assertEquals("<raw> & text", root.text)
    }

    @Test
    fun `throws on mismatched closing tags instead of silently misattributing content`() {
        assertFailsWith<XmlParseException> {
            XmlParser.parse("<Root><A>x</B></Root>")
        }
    }
}
