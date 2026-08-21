import { Metadata } from 'next';
import Link from 'next/link';
import ContentPageLayout, { ContentHeader } from '@/components/layout/ContentPageLayout';

export const metadata: Metadata = {
  title: 'Why You Can\'t Click to Place Your Cursor in a Terminal - Research Notes - Source Library',
  description:
    'Terminal emulators don\'t know what\'s on screen. They draw characters on a grid and forward keystrokes. That architectural decision from 1978 is why basic text editing feels broken in 2026.',
  openGraph: {
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
    title: 'Why You Can\'t Click to Place Your Cursor in a Terminal',
    description: 'The 1978 architecture decision that still shapes how 50 million developers work.',
  },
  twitter: {
    card: 'summary_large_image',
    images: [{ url: 'https://sourcelibrary.org/og-image.jpg', alt: 'Source Library — Digitizing and translating ancient texts' }],
  },
  alternates: {
    canonical: '/blog/why-terminals-cant-edit',
  },
};

export default function WhyTerminalsCantEditPage() {
  return (
    <ContentPageLayout
      header={
        <ContentHeader
          title="Why You Can&rsquo;t Click to Place Your Cursor in a Terminal"
          subtitle="The 1978 architecture decision that still shapes how 50 million developers work"
        >
          <p className="text-stone-400 text-sm mt-4">2 March 2026 &middot; 10 min read</p>
        </ContentHeader>
      }
      bg="bg-cream"
    >
      <div className="mb-8">
        <Link
          href="/blog"
          className="inline-flex items-center gap-2 text-muted hover:text-secondary transition-colors text-sm"
        >
          <svg
            className="w-4 h-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
          All notes
        </Link>
      </div>

      <article className="prose-content max-w-none">
        <p className="text-xl text-secondary leading-relaxed mb-8 font-body">
          I had used a terminal maybe a few dozen times before November 2024. Then Claude Code happened,
          and now I spend more time in the terminal than in any other application &mdash; including my
          web browser. On any given day I have 15 to 25 terminal windows open, each running
          a different AI coding session.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          And every day, I try to click somewhere in the text I&rsquo;m typing and place my cursor
          there. It doesn&rsquo;t work. I try to highlight a word and type over it. That doesn&rsquo;t
          work either. These are things I do in literally every other application on my computer &mdash;
          my browser, my text editor, my notes app, even the search bar in Finder. But the terminal,
          the application I now use the most, can&rsquo;t do it.
        </p>

        <p className="text-secondary leading-relaxed mb-8 font-body">
          I went looking for a terminal that could. I tried Ghostty, iTerm2, Warp, Kitty. None of them
          support it. I asked on Hacker News. The responses split into two camps: &ldquo;that&rsquo;s
          not the terminal&rsquo;s job&rdquo; and &ldquo;of course it&rsquo;s the terminal&rsquo;s
          job.&rdquo; Both are right, and the reason both are right reveals something genuinely strange
          about how we build software in 2026.
        </p>

        <hr className="my-12 border-border-light" />

        <h2 className="font-serif text-2xl text-primary mb-6">The Character Grid</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          A terminal emulator is, at its core, a screen made of characters. Think of a spreadsheet
          where every cell is exactly one character wide. The terminal has one job: receive bytes from
          a program, interpret them as characters and control codes, and draw them on the grid.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          This design comes from the DEC VT100, released in 1978. The VT100 was a physical device &mdash;
          a screen and keyboard connected to a remote computer via a serial cable. The computer sent
          characters down the wire. The VT100 drew them. The user typed. The VT100 sent those keystrokes
          back up the wire. That was the entire contract.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Every modern terminal emulator &mdash; Ghostty, iTerm2, Terminal.app, Windows Terminal,
          Kitty, Alacritty &mdash; still implements this same contract. They are software pretending
          to be a VT100. The program running inside the terminal (your shell, vim, python, Claude Code)
          sends escape codes like <code className="bg-warm px-1.5 py-0.5 rounded text-sm">\e[12;5H</code> meaning
          &ldquo;move the cursor to row 12, column 5&rdquo; or <code className="bg-warm px-1.5 py-0.5 rounded text-sm">\e[31m</code> meaning
          &ldquo;switch to red text.&rdquo; The terminal obeys. It doesn&rsquo;t ask why.
        </p>

        <hr className="my-12 border-border-light" />

        <h2 className="font-serif text-2xl text-primary mb-6">The Blindness Problem</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Here is the fundamental issue: <strong>the terminal emulator does not know what is on
          screen.</strong>
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          That sounds absurd &mdash; it&rsquo;s drawing the screen, how can it not know? But the
          terminal only knows what characters are at which grid positions. It does not know what those
          characters <em>mean</em>. When you see this:
        </p>

        <div className="bg-dark text-green-400 font-mono p-6 rounded-lg my-8 text-sm leading-relaxed">
          <span className="text-blue-400">derek@mac</span> <span className="text-accent-gold">~/sourcelibrary</span> $ git commit -m &quot;fix the bug&quot;
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          You see a prompt, a command, and a string argument. The terminal sees 58 characters on
          row 24. It doesn&rsquo;t know where the prompt ends. It doesn&rsquo;t know that <code className="bg-warm px-1.5 py-0.5 rounded text-sm">$</code> is
          a prompt delimiter. It doesn&rsquo;t know which characters you typed and which
          were printed by the system. It doesn&rsquo;t know
          that <code className="bg-warm px-1.5 py-0.5 rounded text-sm">fix the bug</code> is
          inside a quoted string that you might want to edit.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          So when you click on the &ldquo;b&rdquo; in &ldquo;bug,&rdquo; the terminal receives a
          mouse event at column 52, row 24. Now what? To place a cursor there, it would need to:
        </p>

        <ol className="text-secondary leading-relaxed mb-8 font-body space-y-3 list-decimal list-inside">
          <li>Figure out that column 52 is inside editable text (not part of the prompt, not output from a previous command)</li>
          <li>Determine that the program currently accepting input is zsh (not vim, not python, not Claude Code)</li>
          <li>Calculate how many arrow-key presses it would take to move zsh&rsquo;s cursor from its current position to that location</li>
          <li>Send those fake keystrokes to zsh</li>
          <li>Hope zsh interprets them correctly</li>
        </ol>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Step 1 is the wall. The terminal genuinely cannot distinguish editable text from anything
          else on screen. It&rsquo;s all just characters on a grid.
        </p>

        <hr className="my-12 border-border-light" />

        <h2 className="font-serif text-2xl text-primary mb-6">Why This Is Different from Every Other Application</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          In a web browser, when you click on a text input, the browser owns that input field. It
          knows the field exists, where it starts and ends, what text is in it, and where your cursor
          should go. The browser is both the renderer and the editor.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          In a terminal, the renderer (the terminal emulator) and the editor (the shell) are different
          programs communicating through a pipe. The terminal renders but doesn&rsquo;t edit.
          The shell edits but doesn&rsquo;t render. Neither has the full picture.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          It&rsquo;s as if your web browser could only display a video feed of a remote desktop,
          and every click had to be translated into a sequence of keyboard shortcuts and sent to the
          remote machine. You&rsquo;d never expect click-to-edit to work in that setup. But that&rsquo;s
          exactly what a terminal is.
        </p>

        <hr className="my-12 border-border-light" />

        <h2 className="font-serif text-2xl text-primary mb-6">The Two Programs Problem</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The situation gets worse when you consider that the terminal doesn&rsquo;t even know
          which program is running inside it. When you launch a terminal, it starts your shell (zsh,
          bash, fish). But the shell launches other programs &mdash; git, python, vim, ssh &mdash; and those
          programs take over the terminal. Each one handles input differently.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          In zsh, pressing the left arrow moves your cursor left in your command. In vim, pressing the
          left arrow (or <code className="bg-warm px-1.5 py-0.5 rounded text-sm">h</code>) moves
          left in normal mode but inserts a character in insert mode. In python&rsquo;s REPL, the left
          arrow works, but only on the current line. In ssh, the left arrow is forwarded to
          whatever&rsquo;s running on the remote machine.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The terminal can&rsquo;t implement &ldquo;click to place cursor&rdquo; without knowing which
          program is running and how that program handles cursor movement. And no reliable mechanism
          exists for the terminal to ask.
        </p>

        <hr className="my-12 border-border-light" />

        <h2 className="font-serif text-2xl text-primary mb-6">&ldquo;Highlight to Delete&rdquo; Is Even Harder</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Click-to-place-cursor is hard. Select-and-type-to-replace is nearly impossible.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          In a text editor, selecting text and pressing a key replaces the selection. This requires
          the application to know: what text is selected, that the user intends to replace it, and how
          to delete the old text and insert the new text atomically. The terminal has none of this.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The terminal can do text selection (drag to highlight, Cmd+C to copy). But that selection
          lives entirely in the terminal emulator. The shell has no idea anything is selected.
          Selection in the terminal is a screen-level operation, like selecting text in a screenshot.
          It doesn&rsquo;t correspond to any editable state in the running program.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          To implement &ldquo;highlight and delete,&rdquo; the terminal would need to translate a
          visual selection on its character grid into the correct sequence of shell editing commands
          (move cursor to start, hold shift, move to end, delete) &mdash; which vary by program, mode,
          and configuration. It&rsquo;s the &ldquo;remote desktop video feed&rdquo; problem again, but worse.
        </p>

        <hr className="my-12 border-border-light" />

        <h2 className="font-serif text-2xl text-primary mb-6">Partial Solutions</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Some programs have chipped away at the edges of this problem:
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          <strong>Shells can advertise prompt boundaries.</strong> The OSC 133 escape sequence lets a
          shell tell the terminal &ldquo;the prompt ends here, user input starts here.&rdquo; iTerm2
          and Ghostty support this. It solves step 1 of the click-to-place problem &mdash; but only for
          the shell, and only when the shell has been configured to emit the sequence.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          <strong>Warp reinvented the input model.</strong> Warp treats the command input as an actual
          text editor, separate from the terminal output. You <em>can</em> click to place your cursor
          in Warp. But Warp achieves this by not being a normal terminal &mdash; it intercepts input before
          the shell sees it. This works for the shell prompt but breaks when you launch vim or ssh
          or anything else that expects raw terminal input.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          <strong>Kitty&rsquo;s keyboard protocol</strong> provides richer keystroke information to
          applications that opt in. This doesn&rsquo;t directly solve clicking, but it&rsquo;s a step
          toward terminals and applications having a shared understanding of input state.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          <strong>Mouse reporting modes</strong> (SGR, X10) let the terminal forward mouse clicks to
          the running application. This is how vim and tmux handle mouse input &mdash; they opt in to
          receiving mouse events and implement their own click handling. But your shell doesn&rsquo;t
          do this by default, and even when it does (zsh has mouse support), the experience is spotty.
        </p>

        <hr className="my-12 border-border-light" />

        <h2 className="font-serif text-2xl text-primary mb-6">What Would Actually Fix It</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The real fix requires programs to tell the terminal about editable regions. Imagine an escape
          sequence like:
        </p>

        <div className="bg-dark text-green-400 font-mono p-6 rounded-lg my-8 text-sm leading-relaxed">
          <span className="text-stone-500"># Hypothetical: &ldquo;editable text field starts at row 24, col 33, length 24&rdquo;</span><br />
          \e[?2048h &nbsp;{'<'}field row=24 col=33 len=24 type=text{'>'}
        </div>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          With this, the terminal could render a real input field overlay at that position. Clicking
          would work. Selection would work. The terminal would own the editing, and only send the
          final text back to the program when the user presses Enter. Like an <code className="bg-warm px-1.5 py-0.5 rounded text-sm">{'<input>'}</code> element
          in HTML.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          This is essentially what Warp does, but hardcoded for the shell prompt. A general-purpose
          protocol would let any program declare input fields &mdash; your shell, a database REPL,
          an AI coding agent asking for confirmation. Every terminal emulator could implement native
          text editing for those fields.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          But adoption would require every shell, every CLI tool, and every terminal to agree on the
          protocol. In an ecosystem where we&rsquo;re still arguing about whether terminals should
          support ligatures, that&rsquo;s a generational project.
        </p>

        <hr className="my-12 border-border-light" />

        <h2 className="font-serif text-2xl text-primary mb-6">Living with the Grid</h2>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          So here we are in 2026, using AI to write software through an interface designed for
          connecting teletypes to mainframes. The irony isn&rsquo;t lost on me. Claude Code &mdash; maybe
          the most advanced consumer of terminal I/O ever built &mdash; is still bound by the
          same character grid that constrained a DEC engineer 48 years ago.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          The terminal has survived this long precisely because of its simplicity. The VT100 contract
          is universal: any program that can write bytes and read keystrokes can use a terminal. That
          universality is why we still use terminals at all, instead of building bespoke GUIs for every
          tool. It&rsquo;s a lowest-common-denominator interface that happens to be good enough for
          almost everything.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body">
          Almost. The one thing it&rsquo;s not good enough for is the thing every other application on
          your computer has done since 1984: letting you click where you want to type.
        </p>

        <p className="text-secondary leading-relaxed mb-6 font-body italic">
          Tools like{' '}
          <a href="https://www.cmux.dev/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
            cmux
          </a>{' '}
          and{' '}
          <a href="https://ghostty.org/" className="text-accent-rust hover:underline" target="_blank" rel="noopener noreferrer">
            Ghostty
          </a>{' '}
          are pushing the edges &mdash; better window management, notifications that tell you which of
          your 25 AI sessions needs attention, integrated browsers for visual feedback. They&rsquo;re
          making the terminal <em>livable</em> for the AI coding era. But the character grid remains.
          Whoever cracks the input field protocol will change how every developer on Earth works.
        </p>
      </article>

      <hr className="my-12 border-border-light" />

    </ContentPageLayout>
  );
}
