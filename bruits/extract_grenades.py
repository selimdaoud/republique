#!/usr/bin/env python3
"""Détecte les pics sonores et exporte un MP3 par événement.

Dépendances : ffmpeg, ffprobe, numpy, scipy, soundfile.
Exemple : python extract_grenades.py original.mp3 --threshold 14 --spacing 2 --before 0.2 --after 3
"""
import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
import soundfile as sf
from scipy.ndimage import median_filter
from scipy.signal import find_peaks


def run(cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True)


def probe_duration(path):
    result = run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                  '-of', 'json', str(path)])
    value = json.loads(result.stdout).get('format', {}).get('duration')
    return float(value) if value is not None else None


def clock(seconds):
    minutes, sec = divmod(max(0, seconds), 60)
    hours, minutes = divmod(int(minutes), 60)
    return f'{hours:02d}:{minutes:02d}:{sec:05.2f}'


def main():
    parser = argparse.ArgumentParser(description='Extraction automatique de sons impulsionnels depuis un MP3')
    parser.add_argument('input', type=Path, help='MP3 source')
    parser.add_argument('--threshold', type=float, default=14, help='Écart minimal au fond local, en dB (défaut : 14)')
    parser.add_argument('--spacing', type=float, default=2, help='Distance minimale entre pics, en secondes (défaut : 2)')
    parser.add_argument('--before', type=float, default=0.2, help='Secondes avant le pic (défaut : 0.2)')
    parser.add_argument('--after', type=float, default=3, help='Secondes après le pic (défaut : 3)')
    parser.add_argument('--output', type=Path, default=Path('grenades'), help='Dossier de sortie')
    args = parser.parse_args()
    if not args.input.is_file():
        parser.error(f'Fichier introuvable : {args.input}')
    if args.spacing <= 0 or args.before < 0 or args.after <= 0:
        parser.error('--spacing et --after doivent être > 0 ; --before doit être >= 0')

    try:
        original_duration = probe_duration(args.input)
        print(f'Durée annoncée du MP3 : {clock(original_duration) if original_duration is not None else "inconnue"}', flush=True)
        with tempfile.TemporaryDirectory(prefix='grenades_') as tmp:
            wav = Path(tmp) / 'decoded.wav'
            print('Décodage complet avec FFmpeg…', flush=True)
            run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-xerror', '-y',
                 '-i', str(args.input), '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', str(wav)])
            audio, sr = sf.read(wav, dtype='float32')
            decoded_duration = len(audio) / sr
            print(f'Durée effectivement décodée : {clock(decoded_duration)} ({len(audio):,} échantillons à {sr} Hz)', flush=True)
            if original_duration is not None and abs(decoded_duration - original_duration) > 1:
                print('ATTENTION : écart > 1 seconde entre durée annoncée et durée décodée.', flush=True)
            if len(audio) == 0:
                raise RuntimeError('Le décodage ne contient aucun échantillon.')

            # RMS par fenêtres de 20 ms, sans supprimer la fin du fichier.
            hop = max(1, round(sr * 0.02))
            nframes = (len(audio) + hop - 1) // hop
            padded = np.pad(audio, (0, nframes * hop - len(audio)))
            frames = padded.reshape(nframes, hop)
            rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1))
            db = 20 * np.log10(np.maximum(rms, 1e-8))
            # Fond local : médiane sur environ 5 secondes.
            window = max(3, round(5 * sr / hop))
            if window % 2 == 0:
                window += 1
            background = median_filter(db, size=window, mode='nearest')
            contrast = db - background
            minimum_distance = max(1, round(args.spacing * sr / hop))
            peaks, props = find_peaks(contrast, height=args.threshold,
                                     distance=minimum_distance, prominence=3)
            times = [float(p * hop / sr) for p in peaks]
            print(f'Analyse effectuée jusqu’à : {clock(decoded_duration)}', flush=True)
            print(f'Pics détectés : {len(times)} (seuil : {args.threshold:g} dB au-dessus du fond local)', flush=True)
            if times:
                print(f'Dernier pic détecté : {clock(times[-1])}', flush=True)
            else:
                print('Aucun pic détecté. Essayez de diminuer --threshold.', flush=True)
                return

            # Fusionner les fenêtres qui se chevauchent : une explosion = un fichier.
            intervals = []
            for t in times:
                start, end = max(0.0, t - args.before), min(decoded_duration, t + args.after)
                if intervals and start <= intervals[-1][1]:
                    intervals[-1] = (intervals[-1][0], max(intervals[-1][1], end))
                else:
                    intervals.append((start, end))
            args.output.mkdir(parents=True, exist_ok=True)
            print(f'Extraits à créer : {len(intervals)}', flush=True)
            for index, (start, end) in enumerate(intervals, 1):
                dest = args.output / f'grenade{index}.mp3'
                run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-y',
                     '-ss', f'{start:.3f}', '-i', str(args.input), '-t', f'{end-start:.3f}',
                     '-vn', '-c:a', 'libmp3lame', '-q:a', '2', str(dest)])
                print(f'[{index}/{len(intervals)}] {dest} : {clock(start)} → {clock(end)} ({end-start:.2f} s)', flush=True)
            print(f'Terminé. {len(intervals)} fichiers dans {args.output.resolve()}', flush=True)
    except subprocess.CalledProcessError as exc:
        print(f'Erreur FFmpeg/ffprobe : {exc.stderr.strip()}', flush=True)
        raise SystemExit(1)


if __name__ == '__main__':
    main()
