# Frontend Integration Guide

## Featured Collections on Homepage

### Reading Collections

```typescript
// Read master index
const index = await fetch('/curator-data/index.json').then(r => r.json());

// Get featured collections
const featured = index.collections
  .filter(c => c.featured)
  .sort((a, b) => a.displayOrder - b.displayOrder);

// Load full collection data
const collection = await fetch(`/curator-data/${featured[0].path}`)
  .then(r => r.json());
```

### Display Format

```tsx
<FeaturedCollections>
  {featured.map(collection => (
    <CollectionCard key={collection.id}>
      <h3>{collection.title}</h3>
      <p>{collection.description}</p>
      <Stats>
        <span>{collection.totalBooks} books</span>
        <span>{collection.totalPages.toLocaleString()} pages</span>
        <span>{collection.dateRange}</span>
      </Stats>
      <Themes>
        {collection.themes.slice(0, 5).map(theme => (
          <Tag key={theme}>{theme}</Tag>
        ))}
      </Themes>
      <Link href={`/collections/${collection.id}`}>
        Explore Collection →
      </Link>
    </CollectionCard>
  ))}
</FeaturedCollections>
```

### Collection Detail Page

```tsx
// /collections/[id] page
const collection = await fetch(`/curator-data/collections/${id}.json`)
  .then(r => r.json());

<CollectionPage>
  <Header>
    <h1>{collection.title}</h1>
    <p>{collection.description}</p>
    <Timeline dateRange={collection.dateRange} />
  </Header>

  {/* Display sections chronologically */}
  {collection.sections?.map(section => (
    <Section key={section.title}>
      <h2>{section.title}</h2>
      <p className="period">{section.period}</p>

      {/* Fetch and display books for this section */}
      <BookGrid>
        {section.bookIds.map(async bookId => {
          const book = await fetchBook(bookId);
          return <BookCard key={bookId} book={book} />;
        })}
      </BookGrid>

      <KeyConcepts>
        {section.keyConcepts.map(concept => (
          <Concept key={concept}>{concept}</Concept>
        ))}
      </KeyConcepts>
    </Section>
  ))}

  {/* Conceptual threads visualization */}
  {collection.conceptualThreads && (
    <ConceptualThreads threads={collection.conceptualThreads} />
  )}

  <ResearchValue>
    <h3>Research Value</h3>
    <p>{collection.researchValue}</p>
  </ResearchValue>
</CollectionPage>
```

## API Routes

### GET /api/collections

```typescript
// Return all collections from index
export async function GET() {
  const index = await readJSON('curator-data/index.json');
  return Response.json(index.collections);
}
```

### GET /api/collections/[id]

```typescript
// Return specific collection with full book data
export async function GET(req: Request, { params }) {
  const { id } = params;
  const collection = await readJSON(`curator-data/collections/${id}.json`);

  // Optionally populate book data
  if (req.query.includes('books=full')) {
    for (const section of collection.sections) {
      section.books = await Promise.all(
        section.bookIds.map(id => fetchBook(id))
      );
    }
  }

  return Response.json(collection);
}
```

### GET /api/collections/featured

```typescript
// Return only featured collections for homepage
export async function GET() {
  const index = await readJSON('curator-data/index.json');
  const featured = index.collections.filter(c => c.featured);

  // Load full collection data
  const collections = await Promise.all(
    featured.map(c => readJSON(c.path))
  );

  return Response.json(collections);
}
```

## LLM Agent Integration

### Curator Skill Usage

```typescript
// When curator skill needs to find collections
const index = await readJSON('curator-data/index.json');

// Find relevant collections by theme
const relevantCollections = index.collections.filter(c =>
  c.themes.some(theme =>
    theme.toLowerCase().includes(userQuery.toLowerCase())
  )
);

// Load specific collection
const collection = await readJSON(relevantCollections[0].path);

// Now agent can work with specific collection data
// without loading entire 214KB curatorreports.md file
```

## Visualization Ideas

### Timeline View
- Horizontal timeline showing all works in chronological order
- Color-coded by theme or geographic origin
- Interactive: click to see book details

### Conceptual Thread Diagram
- Graph visualization showing evolution of ideas
- Nodes = authors/works
- Edges = influence relationships
- Example: "Natural Order" thread from Plato → Hayek

### Geographic Map
- World map showing origins of works
- Cluster markers for dense regions (Athens, Rome, Edinburgh, Vienna)
- Filter by time period

### Network Graph
- Authors as nodes
- Intellectual influences as edges
- Teacher-student relationships (Hutcheson → Smith)
- Citation relationships
