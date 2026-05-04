import { NextRequest, NextResponse } from 'next/server';
import { getDb } from './mongodb';

export interface EditorContext {
  email: string;
  userId: string;
  role: string;
  scopes: string[];
}

/**
 * Authenticate an editor API request via Bearer token (API key).
 * Returns the editor context or a 401/403 response.
 */
export async function authenticateEditor(
  request: NextRequest,
  requiredScope: string
): Promise<EditorContext | NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json(
      { error: 'Missing Authorization header. Use: Bearer <api_key>' },
      { status: 401 }
    );
  }

  const key = authHeader.slice(7);
  const db = await getDb();

  const apiKey = await db.collection('api_keys').findOne({
    key,
    active: true,
  });

  if (!apiKey) {
    return NextResponse.json({ error: 'Invalid or inactive API key' }, { status: 401 });
  }

  if (!apiKey.scopes?.includes(requiredScope)) {
    return NextResponse.json(
      { error: `API key lacks required scope: ${requiredScope}` },
      { status: 403 }
    );
  }

  return {
    email: apiKey.email,
    userId: apiKey.userId,
    role: apiKey.role,
    scopes: apiKey.scopes,
  };
}

/**
 * Check if an editor owns a collection (created_by matches their email).
 * Admins bypass this check.
 */
export async function checkCollectionOwnership(
  slug: string,
  editor: EditorContext
): Promise<{ owned: boolean; collection: any | null }> {
  const db = await getDb();
  const col = await db.collection('collections').findOne({ slug });

  if (!col) return { owned: false, collection: null };

  // Admins can edit any collection
  if (editor.role === 'admin' || editor.role === 'superadmin') {
    return { owned: true, collection: col };
  }

  // Editors can only edit collections they created
  if (col.created_by === editor.email) {
    return { owned: true, collection: col };
  }

  return { owned: false, collection: col };
}
