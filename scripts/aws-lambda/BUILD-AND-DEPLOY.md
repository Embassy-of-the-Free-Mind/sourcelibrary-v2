1. In terminal run: `npm run lambda:all`
2. Two packages are built:
    - `dist/packages/book-processor.zip`
    - `dist/packages/ocr-processor.zip`
3. Manually deploying in AWS Console
    1. AWS Console -> Lambda -> Functions
    2. Example, Select `sourcelibrary-book-processor` Lambda function.
    3. Code Tab -> Upload from -> .zip file
    4. Select the zip file at `dist/packages/book-processor.zip`
    5. Similarly update `sourcelibrary-ocr-processor` Lambda function when needed.