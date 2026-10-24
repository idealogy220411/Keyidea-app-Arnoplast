#!/usr/bin/env -S npx tsx
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { LINE_IDS, type IndexFile, type LineId } from '@arnoplast/schema';
import { Command, Help, Option } from 'commander';
import { buildLine } from './build';
import { loadConfig } from './config';
import { ENVIRONMENTS, indexPathOf, publishLine, rollbackLine, type PublishEnv } from './publish/publish';
import { storeFromEnv } from './publish/store';
import type { Issue } from './types';

/** Commander scrive in inglese le intestazioni dell'aiuto e i messaggi d'errore: qui si traducono. */
const TITLES: Record<string, string> = {
  'Usage:': 'Uso:',
  'Options:': 'Opzioni:',
  'Commands:': 'Comandi:',
  'Arguments:': 'Argomenti:',
};

const ERRORS: Array<[RegExp, string]> = [
  [/^error: required option '(.+)' not specified/, "errore: manca l'opzione obbligatoria '$1'"],
  [/^error: unknown option '(.+?)'/, "errore: opzione sconosciuta '$1'"],
  [/^error: option '(.+?)' argument missing/, "errore: manca il valore dell'opzione '$1'"],
  [/^error: unknown command '(.+?)'/, "errore: comando sconosciuto '$1'"],
  [
    /^error: option '(.+?)' argument '(.+?)' is invalid\. Allowed choices are (.+?)\./,
    "errore: il valore '$2' dell'opzione '$1' non è valido (valori ammessi: $3)",
  ],
];

const translateError = (text: string): string =>
  ERRORS.reduce((message, [pattern, replacement]) => message.replace(pattern, replacement), text);

const plural = (count: number, one: string, many: string): string => `${count} ${count === 1 ? one : many}`;

function printSummary(line: string, edition: string, issues: Issue[], reportPath: string): void {
  const errors = issues.filter((issue) => issue.level === 'error');
  const warnings = issues.filter((issue) => issue.level === 'warning');
  console.log(`Linea ${line}, edizione ${edition}`);
  for (const { where, message } of errors) console.log(`  errore${where ? ` (${where})` : ''}: ${message}`);
  console.log(`Errori: ${errors.length}`);
  console.log(`Avvisi: ${warnings.length}`);
  // Con linea o edizione non valide non si scrive nessun rapporto.
  if (existsSync(reportPath)) console.log(`Rapporto: ${reportPath}`);
}

function printPublished(action: string, line: string, env: PublishEnv, index: IndexFile): void {
  const entry = index.lines[line as LineId];
  console.log(`${action}: linea ${line}, ambiente ${env}`);
  console.log(`Edizione corrente: ${entry?.edition}`);
  console.log(`Edizioni precedenti: ${entry?.previous.length ? entry.previous.join(', ') : 'nessuna'}`);
  console.log(`Indice: ${indexPathOf(env)}`);
}

const environmentOption = () =>
  new Option('--ambiente <nome>', 'ambiente su cui pubblicare')
    .choices(ENVIRONMENTS)
    .default('prova');

const program = new Command()
  .name('catalogo')
  .description('Strumenti per preparare e pubblicare il catalogo Arno Plast')
  .configureHelp({
    styleTitle: (title) => TITLES[title] ?? title,
    optionDescription(option) {
      return Help.prototype.optionDescription
        .call(this, option)
        .replace('default: ', 'predefinito: ')
        .replace('choices: ', 'valori ammessi: ');
    },
  })
  .usage('[opzioni] [comando]')
  .configureOutput({ outputError: (text, write) => write(translateError(text)) })
  .helpOption('-h, --help', "mostra l'aiuto")
  .helpCommand('help [comando]', "mostra l'aiuto di un comando")
  .showHelpAfterError("(usa --help per l'elenco delle opzioni)");

program
  .command('build')
  .description('Converte i pacchetti InDesign di una linea in dati, immagini e rapporto')
  .usage('--linea <id> --edizione <AAAA.N> --input <cartella> [opzioni]')
  .requiredOption('--linea <id>', `linea del catalogo (${LINE_IDS.join(', ')})`)
  .requiredOption('--edizione <AAAA.N>', 'edizione, per esempio 2026.1')
  .requiredOption('--input <cartella>', 'cartella con una sottocartella per lingua (it, en…), ognuna con un file .idml e i Links')
  .option('--out <cartella>', 'cartella in cui scrivere il risultato', 'out')
  .option('--config <file>', 'file di configurazione', 'catalogo.config.yaml')
  .action(async (options: { linea: string; edizione: string; input: string; out: string; config: string }) => {
    const result = await buildLine({
      // `buildLine` controlla linea ed edizione e le segnala come errori.
      line: options.linea as LineId,
      edition: options.edizione,
      inputDir: resolve(options.input),
      outDir: resolve(options.out),
      configPath: resolve(options.config),
    });
    printSummary(options.linea, options.edizione, result.issues, result.reportPath);
    process.exitCode = result.ok ? 0 : 1;
  });

program
  .command('publish')
  .description("Carica una linea già costruita sull'hosting (le variabili ARNO_SFTP_* dicono dove)")
  .usage('--linea <id> --edizione <AAAA.N> [opzioni]')
  .requiredOption('--linea <id>', `linea del catalogo (${LINE_IDS.join(', ')})`)
  .requiredOption('--edizione <AAAA.N>', 'edizione già costruita con «build», per esempio 2026.1')
  .addOption(environmentOption())
  .option('--out <cartella>', 'cartella in cui «build» ha scritto il risultato', 'out')
  .option('--config <file>', 'file di configurazione (serve per i contatti)', 'catalogo.config.yaml')
  .action(async (options: { linea: string; edizione: string; ambiente: PublishEnv; out: string; config: string }) => {
    const config = await loadConfig(resolve(options.config));
    const store = await storeFromEnv(process.env);
    try {
      const index = await publishLine(store, {
        // `publishLine` controlla linea ed edizione.
        line: options.linea as LineId,
        edition: options.edizione,
        buildDir: resolve(options.out),
        env: options.ambiente,
        contacts: config.contacts,
        now: new Date(),
      });
      printPublished('Pubblicato', options.linea, options.ambiente, index);
    } finally {
      await store.close();
    }
  });

program
  .command('rollback')
  .description("Riporta una linea all'edizione precedente, senza caricare nulla")
  .usage('--linea <id> [opzioni]')
  .requiredOption('--linea <id>', `linea del catalogo (${LINE_IDS.join(', ')})`)
  .addOption(environmentOption())
  .action(async (options: { linea: string; ambiente: PublishEnv }) => {
    const store = await storeFromEnv(process.env);
    try {
      const index = await rollbackLine(store, { line: options.linea as LineId, env: options.ambiente, now: new Date() });
      printPublished("Ripristinata l'edizione precedente", options.linea, options.ambiente, index);
    } finally {
      await store.close();
    }
  });

try {
  await program.parseAsync();
} catch (error) {
  console.error(`Errore: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
