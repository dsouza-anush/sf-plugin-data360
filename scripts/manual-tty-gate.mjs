if (process.env.D360_MANUAL_TTY_ACK !== '1') {
  throw new Error(
    'T5 requires a human terminal run of test/manual/*.md. Set D360_MANUAL_TTY_ACK=1 only after completing the checklists.'
  );
}

process.stdout.write('PASS T5 manual TTY checklists acknowledged for this release run.\n');
