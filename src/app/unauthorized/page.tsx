import Link from 'next/link';

export default function UnauthorizedPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-8 p-8">
        <div className="text-center">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">403</h1>
          <h2 className="text-2xl font-semibold text-gray-800 mb-4">
            Access Denied
          </h2>
          <p className="text-gray-600 mb-8">
            You don't have permission to access this page. This area is
            restricted to administrators only.
          </p>
          <div className="space-y-4">
            <Link
              href="/"
              className="inline-block w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-md transition-colors"
            >
              Go to Homepage
            </Link>
            <p className="text-sm text-gray-500">
              If you believe you should have access, please contact an
              administrator.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
