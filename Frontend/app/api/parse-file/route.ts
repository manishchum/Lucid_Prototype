import { NextRequest, NextResponse } from 'next/server';
import pdf from 'pdf-parse/lib/pdf-parse.js';
import mammoth from 'mammoth';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    let extractedText = '';

    // Parse based on file type
    if (file.type === 'application/pdf') {
      // Parse PDF directly from buffer
      try {
        const dataBuffer = await pdf(buffer);
        extractedText = dataBuffer.text;
      } catch (pdfError) {
        console.error('PDF parsing error:', pdfError);
        return NextResponse.json(
          { error: 'Failed to parse PDF. The file may be corrupted or password-protected.' },
          { status: 400 }
        );
      }
    } else if (
      file.type === 'application/msword' ||
      file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ) {
      // Parse Word document directly from buffer
      try {
        const result = await mammoth.extractRawText({ buffer });
        extractedText = result.value;
      } catch (docError) {
        console.error('Word document parsing error:', docError);
        return NextResponse.json(
          { error: 'Failed to parse Word document. The file may be corrupted.' },
          { status: 400 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Unsupported file type. Please upload a PDF or Word document.' },
        { status: 400 }
      );
    }

    // Clean up extracted text
    extractedText = extractedText
      .replace(/\s+/g, ' ') // Replace multiple spaces with single space
      .replace(/\n+/g, '\n') // Replace multiple newlines with single newline
      .trim();

    if (!extractedText || extractedText.length < 50) {
      return NextResponse.json(
        { error: 'Failed to extract meaningful text from the file. The document may be empty or contain only images.' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      text: extractedText,
      filename: file.name,
    });

  } catch (error) {
    console.error('Error parsing file:', error);
    return NextResponse.json(
      { error: 'Failed to parse the file. Please ensure it is a valid PDF or Word document.' },
      { status: 500 }
    );
  }
}

// export const config = {
//   api: {
//     bodyParser: false,
//   },
// };
