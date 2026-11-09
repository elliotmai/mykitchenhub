// src/hooks/useRecipeImport.js
// Brings recipes into the shared library from Markdown: a Pestle "Export all"
// zip, loose .md files, or text pasted from ChatGPT / Claude.
//
// Two steps, so nothing is written until the cook has seen what will happen:
//   1. prepareFiles(files) / prepareText(text) — parse every recipe in the
//      browser and set aside the ones already in the library (by name).
//   2. commit() — write the rest in batches under the cook's own uid.
//
// Imported recipes are `source: 'user-created'` with `createdBy` set to the
// importer, which is what the security rules already accept, and which lets
// the cook delete one later. `importedFrom` says where they came from.

import { useCallback, useState } from 'react';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';

import { db } from '../services/firebase';
import { useAuth } from './useAuth';
import { friendlyError } from '../utils/firebaseErrors';
import { extractMarkdownFiles, pastedTextToFiles, planRecipeImport } from '../utils/recipeImport';

/** Firestore allows 500 writes per batch; smaller batches give a smoother progress bar. */
export const BATCH_SIZE = 50;

const readFile = (file) =>
  typeof file.arrayBuffer === 'function'
    ? file.arrayBuffer()
    : new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      });

/**
 * useRecipeImport
 *
 * const { plan, preparing, committing, progress, result, error,
 *         prepareFiles, prepareText, commit, reset } = useRecipeImport(existingRecipes);
 */
const useRecipeImport = (existingRecipes = []) => {
  const { user } = useAuth();

  const [plan, setPlan] = useState(null);
  const [preparing, setPreparing] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setPlan(null);
    setPreparing(false);
    setCommitting(false);
    setProgress({ done: 0, total: 0 });
    setResult(null);
    setError('');
  }, []);

  const prepareFiles = useCallback(
    async (fileList) => {
      setError('');
      setResult(null);
      setPreparing(true);
      try {
        const files = await Promise.all(
          Array.from(fileList ?? []).map(async (file) => ({
            name: file.name,
            bytes: new Uint8Array(await readFile(file)),
          }))
        );
        const markdown = extractMarkdownFiles(files);
        if (markdown.length === 0) {
          setPlan(null);
          setError('No Pestle recipes found. Choose the .zip from Pestle’s “Export all”.');
          return null;
        }
        const next = planRecipeImport(markdown, existingRecipes, 'pestle');
        setPlan(next);
        return next;
      } catch (err) {
        console.error('Error reading Pestle export:', err);
        setPlan(null);
        setError('That file could not be read. Is it the zip Pestle exported?');
        return null;
      } finally {
        setPreparing(false);
      }
    },
    [existingRecipes]
  );

  const prepareText = useCallback(
    (text) => {
      setError('');
      setResult(null);
      const chunks = pastedTextToFiles(text);
      if (chunks.length === 0) {
        setPlan(null);
        setError('Paste a recipe first.');
        return null;
      }
      const next = planRecipeImport(chunks, existingRecipes, 'pasted');
      setPlan(next);
      if (next.ready.length === 0 && next.duplicates.length === 0) {
        setError(
          'Couldn’t find a recipe in that text. It needs a title and an ingredients list — ' +
            'use “Copy format” and ask the assistant to rewrite it.'
        );
      }
      return next;
    },
    [existingRecipes]
  );

  const commit = useCallback(async () => {
    if (!user?.uid) {
      setError('Sign in first.');
      return { success: false };
    }
    const ready = plan?.ready ?? [];
    if (ready.length === 0) return { success: true, imported: 0 };

    setError('');
    setCommitting(true);
    setProgress({ done: 0, total: ready.length });

    let imported = 0;
    const ids = [];
    try {
      for (let start = 0; start < ready.length; start += BATCH_SIZE) {
        const chunk = ready.slice(start, start + BATCH_SIZE);
        const batch = writeBatch(db);
        for (const item of chunk) {
          const ref = doc(collection(db, 'recipes'));
          ids.push(ref.id);
          batch.set(ref, {
            ...item.document,
            createdAt: serverTimestamp(),
            createdBy: user.uid,
          });
        }
        await batch.commit();
        imported += chunk.length;
        setProgress({ done: imported, total: ready.length });
      }
      const outcome = { success: true, imported, ids };
      setResult(outcome);
      return outcome;
    } catch (err) {
      console.error('Error importing Pestle recipes:', err);
      const message = friendlyError(err, { action: 'import those recipes' });
      setError(
        imported > 0
          ? `${imported} of ${ready.length} recipes were imported before it stopped: ${message} Choose the file again to import the rest — the ones already added will be skipped.`
          : message
      );
      const outcome = { success: false, imported };
      setResult(outcome);
      return outcome;
    } finally {
      setCommitting(false);
    }
  }, [plan, user?.uid]);

  return {
    plan,
    preparing,
    committing,
    progress,
    result,
    error,
    prepareFiles,
    prepareText,
    commit,
    reset,
  };
};

export default useRecipeImport;
