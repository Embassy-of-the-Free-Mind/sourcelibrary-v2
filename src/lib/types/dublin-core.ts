// Dublin Core metadata for library interoperability
// See: https://www.dublincore.org/specifications/dublin-core/dcmi-terms/
export interface DublinCoreMetadata {
  // dc:title - handled by Book.title / Book.display_title
  // dc:creator - handled by Book.author
  // dc:date - handled by Book.published
  // dc:language - handled by Book.language

  dc_subject?: string[];        // Topics, keywords, classification codes
  dc_description?: string;      // Abstract or table of contents
  dc_publisher?: string;        // Original publisher
  dc_contributor?: string[];    // Other contributors (translators, editors)
  dc_type?: string;             // e.g., "Text", "Manuscript", "Book"
  dc_format?: string;           // Physical format, e.g., "24 cm, 120 pages"
  dc_identifier?: string[];     // ISBN, OCLC number, catalog IDs
  dc_source?: string;           // Physical location (library, archive, collection)
  dc_relation?: string[];       // Related works, other editions
  dc_coverage?: string;         // Geographic or temporal scope
  dc_rights?: string;           // Rights statement (use license for standard licenses)
}