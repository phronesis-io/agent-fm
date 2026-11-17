# Independent sounds: release evidence

2026-11-17. Twenty new recordings, twenty distinct visual partners, ten new credited creator identities, 71.9 minutes. Existing collection: 435 local pairings; candidate total: 455, plus four YouTube seeds. Sound catalogue: 79 → 99 entries (includes existing synthesized ambience).

## Creator identity and actual context

| Creator | Documented context | Selected recordings |
| --- | --- | --- |
| [Meydän](https://meydan.bandcamp.com/) | France | Interplanetary Forest, Insomnia Pt. 2 |
| [Javier Suarez / Jahzzar](https://jahzzar.bandcamp.com/music) | Gijón, Spain | Curves, Dew |
| [Axletree](https://freemusicarchive.org/music/Axletree/) | British and Irish folk repertoire | The Silent Grove, Amhrán na Leabhar (Song of the books) |
| [Lee Rosevere](https://pei.art/lee-rosevere/) | Prince Edward Island, Canada | Slow Lights, Featherlight |
| [Rrrrrose Azerty / Komiku](https://freemusicarchive.org/music/Komiku/bio/) | Role-playing and independent game music | Quiet Saturday, Swimming with the fish |
| [Rafael Archangel](https://freemusicarchive.org/music/Rafael_Archangel/bio/) | Brazil | Calm Down, Thinking |
| [John Bartmann](https://johnbartmann.bandcamp.com/) | Cape Town, South Africa | riverside-retreat-master, memory-shores-master |
| [Scott Buckley](https://www.scottbuckley.com.au/about/) | Brisbane, Australia | Solace, In This Moment |
| [Sei Mutsuki / PeriTune](https://peritune.com/about/) | Japan | Minamo, Quiet_Ocean |
| [Alexander Nakarada](https://creatorchords.com/) | Norway | Autumn Walk, 8-bit Tavern |

Nationality, creative location, repertoire and scene are distinct. In particular: Bartmann’s ambient works are not labelled traditional African music; Archangel’s instrumentals are not labelled samba; Nakarada’s fantasy arrangements are not described as historical Nordic performances. Axletree’s Irish air is explicitly a low-F-whistle performance. Komiku/Rrrrrose Azerty is one identity. PeriTune/Sei Mutsuki is one identity.

## Evidence and limits

- All 20 source media and output files have distinct SHA-256 hashes. Each original page, track license and creator source is recorded in independent-recordings.json.
- All 20 shipped files passed complete FFmpeg decoding. Output level checks measure the shipped bytes, not only the original download. Maximum true peak: -2.57 dBTP. Loudest integrated level: -20.39 LUFS. Only constant attenuation and MP3 encoding were applied; no trimming, fabricated playing or voice removal.
- Visual contact sheet inspected for all 20 pairs. Facts preserve existing visual provenance; new artist/recording facts carry their own sources. Interpretations remain separate and folded.
- Browser test uses actual visible switch buttons for all 20, checks audio-time advancement and image decode, reversible translation, running-clock preservation, paused switching and no model calls. Muted browser playback is not a human listening audition.
- Human audition and a full work-session listening judgement remain unverified. Source descriptions and genres informed the selection; legacy FMA instrumental flags are inconsistent and are not used as sole proof of instrumentation.
- No default-rotation or Agent delivery change. New recordings remain curated-only. The shelf promotes the new editorial collection; Agent-provided programs cannot claim that reserved collection.

## Excluded or deferred candidates

| Candidate | Reason |
| --- | --- |
| Kai Engel | Current artist site is moving away from CC; not selected from a legacy tag alone. |
| Yusuke Tsutsumi / Daniel Birch / Sergey Cheremisinov candidates | Examined tracks carry noncommercial terms; not included in this redistributable pack. |
| Koto performance / saz sound examples | Short instrument demonstrations or unnamed performers, rather than sustained authored work-session recordings. |
| Historical Shikanotoone | Recording-date and rights evidence remain insufficient. |
| Nakarada: Nomadic Sunset / Fjeld | Source mood labels emphasize dramatic/majestic material; selected relaxed Autumn Walk and 8-bit Tavern instead. |
| Iranian orchestral santur concerto | Recording permission exists, but an orchestral concerto was not accepted merely to fill a country slot. |

## Validation

TypeScript and 67 unit tests passed. Full browser run: 33 passed, one obsolete first-group expectation failed; that expectation and the new 20-recording case were rerun successfully (34 distinct browser cases covered). Installed-release evidence is recorded after deployment.
