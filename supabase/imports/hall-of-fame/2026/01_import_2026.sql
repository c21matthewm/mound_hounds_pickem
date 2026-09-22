-- ONE-TIME 2026 HALL OF FAME IMPORT
-- Run this WHOLE file in Supabase SQL Editor for the league project.
-- Expected: 2026, 78 entries, 18 races, Matt - Team Nash, 2684 points.
-- User-approved tiebreak corrections: swap source places 26/27, 39/40, and 42/43.
-- Last score column is the final race; the preceding column is the second-to-last race.
-- Creates only Hall of Fame records. Does not replace existing archives or modify accounts,
-- operational seasons, drivers, picks, race results, registration, cron jobs, or the schema.
-- Name - Team labels, punctuation, capitalization, and emoji are preserved.
-- race_breakdown stays [] because race names, dates, and database IDs were not provided.
-- All 18 scores and the original sheet rank are retained below for validation/provenance.
-- finalized_at is the import time, not a claimed race completion time; finalized_by is NULL.
-- Original paste SHA-256: 8e94ec4c70e68a1a624072910aced3c082a6bc927dfa95fa4e5de53d71c0c548

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $hof_2026_import$
declare
  archive_id bigint;
  imported_count integer;
  source_row record;
  entries jsonb := $hof_2026_data$
[
  {"final_rank": 1, "source_rank": 1, "team_name": "Matt - Team Nash", "total_points": 2684, "race_points": [184, 158, 195, 163, 115, 145, 118, 142, 173, 147, 153, 67, 172, 121, 147, 158, 186, 140]},
  {"final_rank": 2, "source_rank": 2, "team_name": "Michael - Lysdexia", "total_points": 2666, "race_points": [199, 130, 195, 154, 113, 168, 123, 142, 159, 137, 159, 147, 172, 137, 103, 157, 141, 130]},
  {"final_rank": 3, "source_rank": 3, "team_name": "Tony - DICE Motorsports", "total_points": 2649, "race_points": [180, 171, 195, 126, 169, 155, 128, 120, 173, 123, 157, 104, 188, 146, 103, 136, 143, 132]},
  {"final_rank": 4, "source_rank": 4, "team_name": "Bob - Lysdexia's aDd", "total_points": 2640, "race_points": [198, 154, 195, 154, 134, 172, 151, 85, 144, 143, 114, 126, 159, 121, 173, 115, 141, 161]},
  {"final_rank": 5, "source_rank": 5, "team_name": "Joshua - MBC Racing", "total_points": 2617, "race_points": [165, 148, 195, 144, 133, 131, 132, 113, 173, 134, 152, 141, 146, 126, 179, 164, 103, 138]},
  {"final_rank": 6, "source_rank": 6, "team_name": "Matthew - Final Piece of the Puzzle", "total_points": 2609, "race_points": [177, 154, 171, 159, 90, 173, 136, 151, 136, 104, 118, 126, 161, 158, 162, 163, 138, 132]},
  {"final_rank": 7, "source_rank": 7, "team_name": "Nicholas - Pickle", "total_points": 2594, "race_points": [184, 166, 195, 178, 108, 173, 130, 117, 157, 149, 114, 116, 172, 152, 104, 130, 119, 130]},
  {"final_rank": 8, "source_rank": 8, "team_name": "Sam - My Mick Stings", "total_points": 2593, "race_points": [175, 165, 170, 150, 169, 97, 143, 138, 176, 119, 144, 157, 135, 154, 82, 127, 188, 104]},
  {"final_rank": 9, "source_rank": 9, "team_name": "Alec - StingRobb RayPants", "total_points": 2592, "race_points": [166, 136, 195, 138, 141, 145, 146, 112, 148, 128, 174, 131, 149, 153, 157, 138, 121, 114]},
  {"final_rank": 10, "source_rank": 10, "team_name": "Doug - Bignotti’s Spanner", "total_points": 2576, "race_points": [195, 118, 195, 164, 147, 146, 171, 105, 147, 104, 153, 144, 155, 182, 103, 83, 103, 161]},
  {"final_rank": 11, "source_rank": 11, "team_name": "Andy - DoctorMolecule Racing", "total_points": 2566, "race_points": [163, 118, 195, 178, 118, 173, 116, 99, 139, 146, 144, 132, 185, 127, 113, 136, 129, 155]},
  {"final_rank": 12, "source_rank": 12, "team_name": "Teresa - Lady in the Beer Hat", "total_points": 2564, "race_points": [180, 135, 173, 141, 175, 145, 127, 122, 107, 130, 152, 133, 161, 124, 102, 142, 158, 157]},
  {"final_rank": 13, "source_rank": 13, "team_name": "Billy - Donkey Brain", "total_points": 2560, "race_points": [164, 136, 195, 136, 118, 168, 127, 99, 167, 146, 159, 123, 141, 115, 140, 138, 117, 171]},
  {"final_rank": 14, "source_rank": 14, "team_name": "Mike - Prach Motors", "total_points": 2540, "race_points": [198, 154, 195, 141, 126, 110, 168, 122, 107, 129, 107, 128, 165, 146, 110, 140, 133, 161]},
  {"final_rank": 15, "source_rank": 15, "team_name": "Rick - Indy on a Shoestring", "total_points": 2527, "race_points": [190, 171, 141, 151, 90, 144, 148, 97, 150, 118, 151, 137, 175, 104, 115, 157, 144, 144]},
  {"final_rank": 16, "source_rank": 16, "team_name": "Jeffrey - Prime47Boiler", "total_points": 2525, "race_points": [198, 148, 195, 178, 147, 145, 151, 103, 128, 123, 165, 130, 149, 54, 140, 161, 141, 69]},
  {"final_rank": 17, "source_rank": 17, "team_name": "William - Mr. Spin and Win", "total_points": 2520, "race_points": [180, 140, 195, 144, 161, 141, 157, 138, 61, 129, 157, 141, 149, 180, 109, 102, 105, 131]},
  {"final_rank": 18, "source_rank": 18, "team_name": "Patrick - Dampfishbone", "total_points": 2510, "race_points": [194, 136, 195, 163, 116, 141, 139, 131, 150, 138, 161, 107, 145, 127, 108, 115, 110, 134]},
  {"final_rank": 19, "source_rank": 19, "team_name": "Dave - A Dog Named Moose", "total_points": 2486, "race_points": [156, 183, 161, 130, 89, 127, 108, 139, 139, 133, 152, 99, 184, 110, 166, 166, 92, 152]},
  {"final_rank": 20, "source_rank": 20, "team_name": "Trent - Cincy3Way", "total_points": 2485, "race_points": [163, 153, 162, 94, 115, 134, 122, 130, 160, 136, 153, 126, 145, 98, 140, 159, 150, 145]},
  {"final_rank": 21, "source_rank": 21, "team_name": "Ethan - Graham Rahal’d Again", "total_points": 2479, "race_points": [54, 148, 195, 144, 144, 161, 130, 123, 139, 138, 165, 113, 169, 133, 154, 130, 107, 132]},
  {"final_rank": 22, "source_rank": 22, "team_name": "Jason - Dallara and Firestone's Dad", "total_points": 2474, "race_points": [160, 136, 195, 163, 118, 145, 122, 118, 107, 138, 165, 125, 141, 133, 98, 111, 162, 137]},
  {"final_rank": 23, "source_rank": 23, "team_name": "Jeff - Old Salty Dogs", "total_points": 2457, "race_points": [175, 163, 147, 161, 48, 175, 128, 120, 144, 139, 161, 130, 133, 128, 118, 136, 127, 124]},
  {"final_rank": 24, "source_rank": 24, "team_name": "Rob - Fastest-33", "total_points": 2454, "race_points": [146, 148, 193, 163, 142, 151, 107, 100, 144, 128, 165, 138, 172, 111, 115, 113, 109, 109]},
  {"final_rank": 25, "source_rank": 25, "team_name": "Lauryn - Larry’s Lightning Laps", "total_points": 2453, "race_points": [126, 153, 182, 123, 115, 160, 158, 106, 163, 102, 158, 123, 137, 123, 145, 111, 125, 143]},
  {"final_rank": 26, "source_rank": 27, "team_name": "Jonathan - The Greatest Testicles in Racing.", "total_points": 2451, "race_points": [194, 158, 141, 165, 139, 138, 102, 142, 139, 124, 158, 131, 134, 121, 115, 124, 112, 114]},
  {"final_rank": 27, "source_rank": 26, "team_name": "Billy 4 - Dixon for Seven", "total_points": 2451, "race_points": [163, 171, 195, 134, 89, 145, 106, 112, 155, 118, 173, 134, 140, 140, 132, 138, 95, 111]},
  {"final_rank": 28, "source_rank": 28, "team_name": "Todd - Hertamania", "total_points": 2426, "race_points": [180, 125, 161, 123, 101, 118, 106, 85, 136, 149, 152, 133, 140, 162, 130, 136, 146, 143]},
  {"final_rank": 29, "source_rank": 29, "team_name": "Devon - Fully Bricked", "total_points": 2395, "race_points": [180, 45, 183, 131, 131, 91, 127, 127, 109, 137, 145, 132, 163, 130, 143, 142, 121, 158]},
  {"final_rank": 30, "source_rank": 30, "team_name": "Tony - Daly Disappointment", "total_points": 2394, "race_points": [152, 140, 205, 145, 110, 144, 115, 103, 188, 133, 68, 141, 121, 103, 118, 138, 121, 149]},
  {"final_rank": 31, "source_rank": 31, "team_name": "P.D. - Dottie Pimpo Racing", "total_points": 2393, "race_points": [177, 170, 149, 198, 136, 115, 144, 106, 101, 141, 100, 67, 138, 111, 159, 83, 127, 171]},
  {"final_rank": 32, "source_rank": 32, "team_name": "Troy - Racing for the future", "total_points": 2384, "race_points": [143, 161, 155, 134, 126, 153, 150, 65, 107, 151, 113, 124, 131, 151, 130, 121, 100, 169]},
  {"final_rank": 33, "source_rank": 33, "team_name": "Steve - Backmarkers", "total_points": 2380, "race_points": [152, 134, 142, 128, 126, 104, 132, 151, 103, 141, 159, 145, 154, 153, 90, 115, 143, 108]},
  {"final_rank": 34, "source_rank": 34, "team_name": "Mark - Radioactive RN Racing", "total_points": 2372, "race_points": [159, 148, 193, 100, 147, 147, 145, 79, 167, 113, 146, 112, 131, 140, 115, 107, 93, 130]},
  {"final_rank": 35, "source_rank": 35, "team_name": "Tyler - Snake Pit Sniffers", "total_points": 2369, "race_points": [179, 181, 170, 130, 162, 165, 103, 129, 143, 109, 108, 125, 126, 120, 48, 132, 170, 69]},
  {"final_rank": 36, "source_rank": 36, "team_name": "Seth - Rocky Mountain Racers", "total_points": 2363, "race_points": [153, 181, 149, 111, 161, 129, 138, 90, 157, 117, 97, 118, 115, 92, 144, 136, 172, 103]},
  {"final_rank": 37, "source_rank": 37, "team_name": "Mark - Greatest Spectacle Racing", "total_points": 2356, "race_points": [184, 193, 159, 112, 130, 137, 95, 108, 163, 145, 113, 120, 168, 54, 103, 117, 121, 134]},
  {"final_rank": 38, "source_rank": 38, "team_name": "Andy - Podium Pick’em Special", "total_points": 2352, "race_points": [114, 166, 160, 119, 165, 119, 107, 120, 162, 130, 114, 136, 155, 97, 89, 159, 129, 111]},
  {"final_rank": 39, "source_rank": 40, "team_name": "Vivi - The Foreigner", "total_points": 2342, "race_points": [133, 153, 181, 139, 114, 135, 166, 109, 119, 112, 148, 67, 115, 111, 146, 112, 105, 177]},
  {"final_rank": 40, "source_rank": 39, "team_name": "Jenna - Schmitt faced in turn 2", "total_points": 2342, "race_points": [174, 147, 135, 178, 139, 107, 95, 98, 103, 116, 144, 128, 115, 125, 155, 138, 87, 158]},
  {"final_rank": 41, "source_rank": 41, "team_name": "Jeff - Masters of Faster", "total_points": 2336, "race_points": [170, 109, 159, 123, 161, 87, 140, 116, 123, 141, 95, 138, 154, 135, 111, 104, 138, 132]},
  {"final_rank": 42, "source_rank": 43, "team_name": "Craig - CRace", "total_points": 2317, "race_points": [171, 147, 161, 78, 164, 103, 168, 120, 160, 148, 132, 87, 125, 54, 139, 145, 100, 115]},
  {"final_rank": 43, "source_rank": 42, "team_name": "Nicole - Kiwi management", "total_points": 2317, "race_points": [151, 162, 189, 100, 130, 111, 143, 127, 128, 118, 119, 109, 114, 146, 172, 84, 105, 109]},
  {"final_rank": 44, "source_rank": 44, "team_name": "Matthew - Matty B", "total_points": 2302, "race_points": [183, 169, 112, 163, 132, 133, 102, 116, 161, 106, 132, 136, 138, 120, 48, 159, 123, 69]},
  {"final_rank": 45, "source_rank": 45, "team_name": "Joe - Indy Rednecks", "total_points": 2300, "race_points": [141, 154, 193, 152, 133, 163, 131, 113, 61, 116, 173, 103, 102, 103, 122, 109, 109, 122]},
  {"final_rank": 46, "source_rank": 46, "team_name": "joe - Front Row Joe", "total_points": 2287, "race_points": [165, 135, 107, 117, 166, 118, 131, 163, 68, 142, 124, 67, 127, 195, 114, 124, 90, 134]},
  {"final_rank": 47, "source_rank": 47, "team_name": "Denis - Racin D4", "total_points": 2264, "race_points": [166, 148, 152, 154, 143, 139, 118, 98, 61, 103, 68, 126, 134, 140, 152, 142, 101, 119]},
  {"final_rank": 48, "source_rank": 48, "team_name": "Jennifer - Racing Photographer", "total_points": 2240, "race_points": [169, 135, 161, 103, 148, 129, 123, 132, 150, 104, 115, 107, 115, 124, 103, 102, 151, 69]},
  {"final_rank": 49, "source_rank": 49, "team_name": "Steven - Whooshmobiles", "total_points": 2231, "race_points": [118, 151, 155, 127, 132, 111, 115, 147, 114, 129, 119, 124, 158, 160, 92, 70, 97, 112]},
  {"final_rank": 50, "source_rank": 50, "team_name": "Robert - PAposseineffect", "total_points": 2189, "race_points": [155, 45, 157, 133, 166, 127, 131, 136, 133, 63, 167, 145, 64, 122, 104, 119, 153, 69]},
  {"final_rank": 51, "source_rank": 51, "team_name": "Andi - 1981 Digital Derby Champ", "total_points": 2183, "race_points": [138, 153, 168, 144, 152, 104, 123, 142, 61, 145, 168, 112, 64, 97, 48, 167, 128, 69]},
  {"final_rank": 52, "source_rank": 52, "team_name": "Andrew - Clutch and Chill", "total_points": 2181, "race_points": [180, 137, 160, 142, 120, 112, 142, 115, 139, 132, 68, 86, 149, 54, 48, 159, 115, 123]},
  {"final_rank": 53, "source_rank": 53, "team_name": "Dan - Woodside Racing", "total_points": 2172, "race_points": [180, 45, 137, 154, 121, 146, 107, 131, 107, 133, 141, 94, 64, 117, 128, 117, 113, 137]},
  {"final_rank": 54, "source_rank": 54, "team_name": "Wesley - Molar Madness", "total_points": 2162, "race_points": [162, 130, 103, 133, 174, 61, 134, 105, 134, 63, 154, 132, 115, 54, 137, 155, 147, 69]},
  {"final_rank": 55, "source_rank": 55, "team_name": "John - Studmuffin", "total_points": 2155, "race_points": [83, 159, 179, 120, 131, 81, 109, 75, 121, 135, 120, 112, 122, 76, 134, 123, 164, 111]},
  {"final_rank": 56, "source_rank": 56, "team_name": "Gina - Danica Patrick", "total_points": 2146, "race_points": [154, 103, 165, 164, 142, 107, 122, 90, 89, 145, 97, 117, 136, 127, 148, 58, 71, 111]},
  {"final_rank": 57, "source_rank": 57, "team_name": "Donna Kay - DK's Pinstripes", "total_points": 2143, "race_points": [127, 114, 134, 136, 123, 111, 124, 94, 111, 125, 125, 133, 102, 128, 81, 111, 142, 122]},
  {"final_rank": 58, "source_rank": 58, "team_name": "Lincoln - Stinkman Racing", "total_points": 2142, "race_points": [151, 171, 170, 127, 120, 139, 143, 118, 92, 116, 112, 127, 64, 54, 115, 118, 136, 69]},
  {"final_rank": 59, "source_rank": 59, "team_name": "Martina - Left Turn Louise", "total_points": 2014, "race_points": [137, 158, 165, 102, 48, 111, 110, 92, 94, 129, 107, 108, 122, 81, 96, 139, 94, 121]},
  {"final_rank": 60, "source_rank": 60, "team_name": "Bryce - Fuzzy's Grandstand", "total_points": 1981, "race_points": [137, 45, 68, 63, 129, 61, 122, 136, 61, 147, 158, 127, 146, 148, 73, 126, 165, 69]},
  {"final_rank": 61, "source_rank": 61, "team_name": "Justin - FreeHotCarl", "total_points": 1973, "race_points": [166, 139, 153, 133, 116, 108, 124, 135, 155, 131, 108, 141, 64, 54, 48, 58, 71, 69]},
  {"final_rank": 62, "source_rank": 62, "team_name": "Alec - B-Rock Racing", "total_points": 1955, "race_points": [54, 183, 150, 63, 166, 104, 74, 130, 142, 113, 107, 152, 64, 147, 48, 84, 105, 69]},
  {"final_rank": 63, "source_rank": 63, "team_name": "Mallory - Hoosier Hot Laps", "total_points": 1906, "race_points": [156, 163, 155, 164, 48, 93, 122, 112, 61, 137, 138, 143, 64, 54, 98, 58, 71, 69]},
  {"final_rank": 64, "source_rank": 64, "team_name": "Diana - Baby Got Track", "total_points": 1891, "race_points": [133, 139, 187, 141, 146, 97, 151, 112, 100, 115, 139, 67, 64, 54, 48, 58, 71, 69]},
  {"final_rank": 65, "source_rank": 65, "team_name": "John - TeamSlim", "total_points": 1856, "race_points": [167, 100, 148, 118, 165, 138, 121, 134, 61, 63, 98, 124, 64, 109, 48, 58, 71, 69]},
  {"final_rank": 66, "source_rank": 66, "team_name": "Haley - Haley's Comets", "total_points": 1839, "race_points": [120, 152, 155, 120, 134, 98, 74, 50, 173, 112, 68, 135, 64, 138, 48, 58, 71, 69]},
  {"final_rank": 67, "source_rank": 67, "team_name": "Matthew - Cars with Stripes Go Faster", "total_points": 1789, "race_points": [164, 124, 147, 180, 162, 101, 106, 91, 102, 113, 68, 67, 64, 54, 48, 58, 71, 69]},
  {"final_rank": 68, "source_rank": 68, "team_name": "Daniel - Jeff Gordon Juggernaut", "total_points": 1766, "race_points": [174, 97, 132, 113, 119, 140, 123, 120, 61, 103, 153, 67, 64, 54, 48, 58, 71, 69]},
  {"final_rank": 69, "source_rank": 69, "team_name": "Eli - Team Zach Smith Sucks", "total_points": 1758, "race_points": [155, 45, 68, 63, 142, 61, 110, 127, 61, 152, 95, 136, 167, 98, 80, 58, 71, 69]},
  {"final_rank": 70, "source_rank": 70, "team_name": "Thomas - Open Wheel Mercenary", "total_points": 1748, "race_points": [159, 45, 149, 127, 144, 160, 74, 50, 176, 63, 68, 67, 64, 54, 48, 58, 71, 171]},
  {"final_rank": 71, "source_rank": 71, "team_name": "Mark - Marlyn Racing", "total_points": 1673, "race_points": [158, 144, 161, 144, 150, 107, 136, 50, 61, 63, 68, 67, 64, 54, 48, 58, 71, 69]},
  {"final_rank": 72, "source_rank": 72, "team_name": "Sam - Sam ayers motorsports", "total_points": 1667, "race_points": [118, 107, 116, 142, 48, 108, 134, 108, 61, 136, 124, 67, 64, 88, 48, 58, 71, 69]},
  {"final_rank": 73, "source_rank": 73, "team_name": "Chris - No Attack No Chance", "total_points": 1648, "race_points": [123, 127, 125, 94, 48, 81, 160, 129, 137, 125, 68, 67, 64, 54, 48, 58, 71, 69]},
  {"final_rank": 74, "source_rank": 74, "team_name": "Mary - Jazz racing", "total_points": 1550, "race_points": [125, 171, 68, 111, 129, 145, 128, 50, 61, 63, 68, 67, 64, 54, 48, 58, 71, 69]},
  {"final_rank": 75, "source_rank": 75, "team_name": "Jacen - Dr4gons", "total_points": 1541, "race_points": [160, 142, 68, 137, 131, 92, 138, 50, 61, 63, 68, 67, 64, 54, 48, 58, 71, 69]},
  {"final_rank": 76, "source_rank": 76, "team_name": "Adelle - KACHOW 🏁🏎️🧡👑", "total_points": 1395, "race_points": [141, 122, 68, 138, 118, 61, 74, 50, 61, 63, 68, 67, 64, 54, 48, 58, 71, 69]},
  {"final_rank": 77, "source_rank": 77, "team_name": "Lyman - Foyt14", "total_points": 1268, "race_points": [137, 45, 167, 63, 48, 61, 74, 50, 61, 63, 68, 67, 64, 54, 48, 58, 71, 69]},
  {"final_rank": 78, "source_rank": 78, "team_name": "shelley - Brown eyed girl", "total_points": 1086, "race_points": [54, 45, 68, 63, 48, 61, 74, 50, 61, 63, 68, 67, 64, 54, 48, 58, 71, 69]}
]
$hof_2026_data$::jsonb;
begin
  if exists (select 1 from public.hall_of_fame_seasons where season_year = 2026) then
    raise exception '2026 already exists in Hall of Fame. Nothing was changed. Run 02_verify_2026.sql; do not delete the existing archive.';
  end if;

  if jsonb_array_length(entries) <> 78 then
    raise exception 'Expected exactly 78 entries for 2026.';
  end if;

  if (select count(distinct entry.final_rank)
      from jsonb_to_recordset(entries) as entry(final_rank integer)) <> 78
    or (select count(distinct entry.source_rank)
        from jsonb_to_recordset(entries) as entry(source_rank integer)) <> 78
  then
    raise exception 'The final ranks and original source ranks must each be unique.';
  end if;

  if (select count(distinct lower(btrim(entry.team_name)))
      from jsonb_to_recordset(entries) as entry(team_name text)) <> 78
  then
    raise exception 'The 2026 participant/team labels must be unique.';
  end if;

  for source_row in
    select * from jsonb_to_recordset(entries) as entry(
      final_rank integer, source_rank integer, team_name text, total_points integer, race_points integer[]
    )
  loop
    if source_row.final_rank is null or source_row.final_rank not between 1 and 78
      or source_row.source_rank is null or source_row.source_rank not between 1 and 78
      or source_row.team_name is null or length(btrim(source_row.team_name)) = 0
      or source_row.total_points is null or source_row.total_points < 0
      or cardinality(source_row.race_points) is distinct from 18
    then
      raise exception 'Invalid 2026 entry at rank %.', source_row.final_rank;
    end if;

    if exists (
      select 1 from unnest(source_row.race_points) as race(points)
      where race.points is null or race.points < 0
    ) or (select sum(points) from unnest(source_row.race_points) as race(points))
      is distinct from source_row.total_points::bigint
    then
      raise exception 'Race scores do not match the total at rank %.', source_row.final_rank;
    end if;
  end loop;

  if exists (
    select 1 from (
      select entry.total_points, entry.race_points[18] as final_race,
        entry.race_points[17] as second_to_last_race,
        lag(entry.total_points) over (order by entry.final_rank) as preceding_total,
        lag(entry.race_points[18]) over (order by entry.final_rank) as preceding_final,
        lag(entry.race_points[17]) over (order by entry.final_rank) as preceding_second_to_last
      from jsonb_to_recordset(entries) as entry(final_rank integer, total_points integer, race_points integer[])
    ) ranked
    where (ranked.total_points, ranked.final_race, ranked.second_to_last_race)
      > (ranked.preceding_total, ranked.preceding_final, ranked.preceding_second_to_last)
  ) then
    raise exception 'Final places do not follow total points, final-race points, then second-to-last-race points.';
  end if;

  if (select md5(string_agg(entry.final_rank::text || ':' || entry.team_name || ':' || entry.total_points::text,
          E'\n' order by entry.final_rank))
      from jsonb_to_recordset(entries) as entry(final_rank integer, team_name text, total_points integer))
      is distinct from '660248340bf21c2c791ee8c19262dab3'
  then
    raise exception 'The 2026 final standings do not match the approved import. Nothing was changed.';
  end if;

  if not exists (
    select 1 from jsonb_to_recordset(entries) as entry(final_rank integer, team_name text, total_points integer)
    where entry.final_rank = 1 and entry.team_name = 'Matt - Team Nash' and entry.total_points = 2684
  ) then
    raise exception 'The 2026 champion does not match the supplied leaderboard.';
  end if;

  insert into public.hall_of_fame_seasons (
    season_year, champion_team_name, champion_total_points,
    participant_count, race_count, finalized_by
  ) values (2026, 'Matt - Team Nash', 2684, 78, 18, null)
  returning id into archive_id;

  insert into public.hall_of_fame_entries (
    season_id, final_rank, team_name, total_points, race_breakdown
  )
  select archive_id, entry.final_rank, entry.team_name, entry.total_points, '[]'::jsonb
  from jsonb_to_recordset(entries) as entry(final_rank integer, team_name text, total_points integer)
  order by entry.final_rank;

  get diagnostics imported_count = row_count;
  if imported_count <> 78 then
    raise exception 'Expected 78 imported entries, received %. Import cancelled.', imported_count;
  end if;

  if exists (
    select 1 from jsonb_to_recordset(entries) as source(final_rank integer, team_name text, total_points integer)
    where not exists (
      select 1 from public.hall_of_fame_entries saved
      where saved.season_id = archive_id and saved.final_rank = source.final_rank
        and saved.team_name = source.team_name and saved.total_points = source.total_points
        and saved.race_breakdown = '[]'::jsonb
    )
  ) then
    raise exception 'Imported entries do not match the approved source. Import cancelled.';
  end if;
end;
$hof_2026_import$;

commit;

-- Read-only verification of the approved 2026 Hall of Fame import.
-- Always returns one row. Run independently after importing or to check an existing archive.
with archive as (
  select
    season.season_year, season.champion_team_name, season.champion_total_points,
    season.participant_count, season.race_count,
    count(entry.id) as imported_entries,
    count(distinct entry.final_rank) as unique_ranks,
    min(entry.final_rank) as first_rank,
    max(entry.final_rank) as last_rank,
    sum(entry.total_points) as combined_points,
    count(*) filter (
      where entry.final_rank = 1
        and entry.team_name = season.champion_team_name
        and entry.total_points = season.champion_total_points
    ) as matching_champions,
    count(entry.id) filter (where entry.race_breakdown = '[]'::jsonb) as empty_breakdowns,
    md5(string_agg(entry.final_rank::text || ':' || entry.team_name || ':' || entry.total_points::text,
      E'\n' order by entry.final_rank)) as standings_fingerprint
  from public.hall_of_fame_seasons season
  left join public.hall_of_fame_entries entry on entry.season_id = season.id
  where season.season_year = 2026
  group by season.id
)
select
  case
    when archive.season_year is null then 'NOT IMPORTED'
    when champion_team_name = 'Matt - Team Nash'
      and champion_total_points = 2684
      and participant_count = 78 and race_count = 18
      and imported_entries = 78 and unique_ranks = 78
      and first_rank = 1 and last_rank = 78
      and combined_points = 173961 and matching_champions = 1
      and empty_breakdowns = 78
      and standings_fingerprint = '660248340bf21c2c791ee8c19262dab3'
    then 'PASS'
    else 'CHECK IMPORT'
  end as verification_status,
  2026 as season_year,
  champion_team_name,
  champion_total_points,
  race_count,
  coalesce(imported_entries, 0) as imported_entries,
  round(champion_total_points::numeric / nullif(race_count, 0), 2) as champion_points_per_race,
  combined_points
from (values (1)) as expected(row_exists)
left join archive on true;
