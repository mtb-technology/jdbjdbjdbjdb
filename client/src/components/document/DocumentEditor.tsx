import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Highlight from '@tiptap/extension-highlight';
import { TextStyle } from '@tiptap/extension-text-style';
import { Color } from '@tiptap/extension-color';
import Placeholder from '@tiptap/extension-placeholder';
import { useEffect, useRef } from 'react';
import type { TipTapContent } from '@shared/document-types';

interface DocumentEditorProps {
  content: TipTapContent | string;
  readOnly?: boolean;
  onChange?: (content: TipTapContent) => void;
  placeholder?: string;
  className?: string;
  highlightedRanges?: Array<{
    from: number;
    to: number;
    color: string;
    specialist?: string;
  }>;
}

export function DocumentEditor({
  content,
  readOnly = false,
  onChange,
  placeholder = 'Start typing...',
  className = '',
  highlightedRanges = []
}: DocumentEditorProps) {
  const initialContentSet = useRef(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle,
      Color,
      Highlight.configure({
        multicolor: true,
      }),
      Placeholder.configure({
        placeholder,
      }),
    ],
    content: '',
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: 'prose prose-sm sm:prose lg:prose-lg xl:prose-xl focus:outline-none max-w-none',
      },
    },
    onUpdate: ({ editor }) => {
      if (onChange && initialContentSet.current) {
        onChange(editor.getJSON() as TipTapContent);
      }
    },
  });

  // Update editor content when prop changes
  useEffect(() => {
    if (!editor || !content) return;

    // Only set content once to avoid cursor jumping
    if (!initialContentSet.current) {
      editor.commands.setContent(content);
      initialContentSet.current = true;
    }
  }, [editor, content]);

  // Apply highlights for pending changes
  useEffect(() => {
    if (!editor || highlightedRanges.length === 0) return;

    // Clear existing highlights
    editor.chain().focus().unsetHighlight().run();

    // Apply new highlights
    highlightedRanges.forEach(({ from, to, color }) => {
      editor
        .chain()
        .focus()
        .setTextSelection({ from, to })
        .setHighlight({ color })
        .run();
    });
  }, [editor, highlightedRanges]);

  if (!editor) {
    return null;
  }

  return (
    <div className={`document-editor ${className}`}>
      {!readOnly && (
        <div className="editor-toolbar border-b border-gray-200 bg-gray-50 p-2 flex gap-2 flex-wrap">
          <button
            onClick={() => editor.chain().focus().toggleBold().run()}
            disabled={!editor.can().chain().focus().toggleBold().run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('bold')
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            <strong>B</strong>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleItalic().run()}
            disabled={!editor.can().chain().focus().toggleItalic().run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('italic')
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            <em>I</em>
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('heading', { level: 2 })
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            H2
          </button>
          <button
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('heading', { level: 3 })
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            H3
          </button>
          <button
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('bulletList')
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            • List
          </button>
          <button
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            className={`px-3 py-1 rounded text-sm font-medium ${
              editor.isActive('orderedList')
                ? 'bg-blue-500 text-white'
                : 'bg-white text-gray-700 hover:bg-gray-100'
            }`}
          >
            1. List
          </button>
          <button
            onClick={() => editor.chain().focus().undo().run()}
            disabled={!editor.can().chain().focus().undo().run()}
            className="px-3 py-1 rounded text-sm font-medium bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            ↶ Undo
          </button>
          <button
            onClick={() => editor.chain().focus().redo().run()}
            disabled={!editor.can().chain().focus().redo().run()}
            className="px-3 py-1 rounded text-sm font-medium bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            ↷ Redo
          </button>
        </div>
      )}
      <div className={`editor-content p-6 ${readOnly ? 'bg-gray-50' : 'bg-white'} min-h-[500px]`}>
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
