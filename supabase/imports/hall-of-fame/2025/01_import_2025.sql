-- ONE-TIME 2025 HALL OF FAME IMPORT
-- Run this WHOLE file in the Supabase SQL Editor for the league project.
-- Confirm: 2025, 89 entries, 17 races, Nicholas - Pickle, 2548 points.
-- Uses existing Hall of Fame tables; never updates/deletes an existing archive.
-- No historical accounts, current-season records, or schema changes are created.
-- The source's Name - Team label is preserved in team_name.
-- Raw race scores are validated here and retained in the adjacent source/CSV files.
-- race_breakdown stays [] because race names/dates/IDs were not supplied.
-- finalized_at uses the import time; finalized_by stays NULL (SQL Editor import).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $hof_2025_import$
declare
  archive_id bigint;
  imported_count integer;
  champion_label text;
  champion_points integer;
  source_row record;
  entries jsonb := $hof_2025_data$
[
  {"final_rank": 1, "team_name": "Nicholas - Pickle", "total_points": 2548, "race_points": [148, 206, 175, 170, 159, 208, 105, 116, 107, 131, 162, 112, 117, 171, 177, 130, 154]},
  {"final_rank": 2, "team_name": "Matthew - Matty B", "total_points": 2543, "race_points": [121, 195, 111, 145, 175, 179, 119, 134, 125, 155, 161, 116, 153, 168, 152, 131, 203]},
  {"final_rank": 3, "team_name": "Michael - Lysdexia", "total_points": 2529, "race_points": [175, 194, 147, 158, 133, 189, 105, 88, 117, 119, 143, 142, 135, 148, 209, 149, 178]},
  {"final_rank": 4, "team_name": "Jonathan - I have no Will Power", "total_points": 2517, "race_points": [160, 194, 147, 152, 165, 194, 133, 93, 119, 150, 112, 150, 68, 145, 163, 181, 191]},
  {"final_rank": 5, "team_name": "Alec - StingRobb RayPants", "total_points": 2512, "race_points": [117, 190, 166, 162, 169, 166, 139, 91, 131, 132, 157, 112, 142, 122, 172, 142, 202]},
  {"final_rank": 6, "team_name": "Mark - Greatest Spectacle", "total_points": 2505, "race_points": [170, 184, 125, 158, 141, 166, 148, 124, 119, 155, 102, 134, 140, 170, 150, 140, 179]},
  {"final_rank": 7, "team_name": "Calvin and Heather - Kiss our Assphalt", "total_points": 2502, "race_points": [105, 178, 179, 157, 171, 206, 114, 110, 150, 142, 151, 140, 90, 134, 151, 162, 162]},
  {"final_rank": 8, "team_name": "Jason - Dallara and Firestone's Dad", "total_points": 2495, "race_points": [141, 193, 175, 141, 151, 215, 131, 106, 121, 167, 162, 102, 137, 161, 156, 116, 120]},
  {"final_rank": 9, "team_name": "Bob - Lysdexia's aDd", "total_points": 2459, "race_points": [170, 169, 151, 153, 136, 208, 139, 124, 119, 139, 161, 86, 118, 177, 155, 126, 128]},
  {"final_rank": 10, "team_name": "Andy - DoctorMolecule Racing", "total_points": 2450, "race_points": [149, 198, 165, 152, 182, 211, 139, 80, 107, 155, 162, 91, 117, 161, 107, 144, 130]},
  {"final_rank": 11, "team_name": "Steven - The Burchyard", "total_points": 2447, "race_points": [136, 184, 110, 155, 115, 189, 149, 130, 131, 153, 130, 124, 100, 151, 172, 147, 171]},
  {"final_rank": 12, "team_name": "Steve - Backmarkers", "total_points": 2435, "race_points": [152, 205, 147, 152, 122, 187, 107, 99, 131, 124, 128, 101, 115, 146, 174, 170, 175]},
  {"final_rank": 13, "team_name": "Seth - Rocky Mountain Racers", "total_points": 2404, "race_points": [139, 177, 150, 130, 110, 189, 100, 107, 140, 125, 151, 138, 139, 153, 190, 124, 142]},
  {"final_rank": 14, "team_name": "Tyler - HelioHead", "total_points": 2402, "race_points": [134, 164, 166, 155, 165, 193, 102, 89, 117, 104, 171, 117, 127, 162, 180, 139, 117]},
  {"final_rank": 15, "team_name": "Andy - Podium Pick'em Special", "total_points": 2374, "race_points": [151, 195, 183, 143, 153, 194, 133, 122, 150, 128, 57, 44, 123, 138, 158, 130, 172]},
  {"final_rank": 16, "team_name": "Todd - Hertamania", "total_points": 2368, "race_points": [110, 169, 147, 160, 155, 190, 105, 85, 95, 177, 136, 100, 142, 168, 163, 161, 105]},
  {"final_rank": 17, "team_name": "Teresa - Sparki’s Squad", "total_points": 2362, "race_points": [136, 164, 167, 160, 125, 181, 88, 83, 128, 165, 112, 142, 117, 132, 180, 136, 146]},
  {"final_rank": 18, "team_name": "Bob  - Indygriller", "total_points": 2360, "race_points": [167, 183, 147, 64, 186, 211, 96, 100, 145, 99, 137, 127, 177, 107, 139, 135, 140]},
  {"final_rank": 19, "team_name": "Adam - 5536SparkPlugger", "total_points": 2359, "race_points": [129, 172, 94, 171, 74, 189, 124, 145, 129, 165, 143, 110, 89, 167, 198, 114, 146]},
  {"final_rank": 20, "team_name": "Steven - Whooshmobiles", "total_points": 2353, "race_points": [161, 205, 147, 158, 138, 187, 94, 106, 132, 92, 132, 135, 107, 166, 116, 116, 161]},
  {"final_rank": 21, "team_name": "Ethan - 3than", "total_points": 2351, "race_points": [141, 184, 116, 129, 138, 162, 114, 142, 136, 139, 162, 148, 134, 146, 143, 123, 94]},
  {"final_rank": 22, "team_name": "P.D. - Cohiba Racing", "total_points": 2351, "race_points": [121, 167, 126, 148, 99, 188, 110, 131, 107, 167, 162, 102, 130, 132, 147, 136, 178]},
  {"final_rank": 23, "team_name": "Mark - Radioactive RN Racing", "total_points": 2348, "race_points": [126, 195, 137, 138, 129, 208, 144, 105, 134, 177, 138, 97, 115, 147, 135, 119, 104]},
  {"final_rank": 24, "team_name": "Dan - Woodside Racing", "total_points": 2346, "race_points": [153, 200, 147, 152, 129, 206, 119, 98, 121, 112, 142, 118, 135, 128, 116, 140, 130]},
  {"final_rank": 25, "team_name": "Billy - Donkey Brain", "total_points": 2342, "race_points": [140, 162, 147, 139, 93, 178, 150, 116, 106, 139, 138, 113, 177, 151, 117, 136, 140]},
  {"final_rank": 26, "team_name": "William - Mr. Spin to win", "total_points": 2342, "race_points": [81, 144, 138, 143, 145, 194, 108, 111, 78, 178, 129, 136, 107, 165, 156, 159, 170]},
  {"final_rank": 27, "team_name": "Phil - Track Hot", "total_points": 2341, "race_points": [119, 200, 158, 153, 142, 195, 122, 87, 119, 140, 119, 123, 151, 132, 106, 141, 134]},
  {"final_rank": 28, "team_name": "Joe - Wombat Wacing", "total_points": 2332, "race_points": [110, 205, 116, 143, 129, 171, 127, 156, 87, 137, 145, 137, 81, 122, 149, 126, 191]},
  {"final_rank": 29, "team_name": "Alex - OVAL OVERLORD", "total_points": 2331, "race_points": [143, 194, 157, 158, 114, 148, 139, 89, 100, 163, 141, 101, 90, 150, 112, 170, 162]},
  {"final_rank": 30, "team_name": "Nicholas - Your Honda's Unser My Chevy", "total_points": 2315, "race_points": [112, 184, 114, 150, 128, 189, 121, 126, 78, 139, 151, 107, 160, 152, 135, 129, 140]},
  {"final_rank": 31, "team_name": "Joshua  - SSR", "total_points": 2307, "race_points": [153, 194, 47, 148, 140, 201, 148, 108, 88, 100, 156, 98, 140, 153, 182, 60, 191]},
  {"final_rank": 32, "team_name": "Billy - Dixon for Seven", "total_points": 2294, "race_points": [132, 179, 122, 150, 114, 164, 125, 124, 166, 160, 103, 109, 153, 123, 97, 147, 126]},
  {"final_rank": 33, "team_name": "Dave - Two Birds in Will Power's Hands", "total_points": 2289, "race_points": [111, 205, 175, 141, 149, 142, 150, 129, 128, 155, 102, 90, 118, 126, 116, 149, 103]},
  {"final_rank": 34, "team_name": "Patrick - Penske is my Father", "total_points": 2289, "race_points": [147, 178, 147, 157, 126, 180, 139, 88, 65, 116, 106, 88, 109, 152, 156, 173, 162]},
  {"final_rank": 35, "team_name": "Jennifer - Racing Photographer", "total_points": 2283, "race_points": [125, 136, 85, 140, 120, 161, 87, 126, 116, 154, 123, 157, 145, 121, 197, 154, 136]},
  {"final_rank": 36, "team_name": "Gina - Danica Patrick", "total_points": 2276, "race_points": [143, 49, 137, 153, 142, 155, 127, 126, 132, 179, 124, 105, 132, 169, 121, 127, 155]},
  {"final_rank": 37, "team_name": "Andi - Red Poncho in Canada", "total_points": 2275, "race_points": [144, 143, 111, 138, 180, 172, 72, 162, 74, 132, 127, 111, 129, 161, 185, 134, 100]},
  {"final_rank": 38, "team_name": "Tyler - Cheeseballers", "total_points": 2253, "race_points": [145, 174, 161, 165, 145, 190, 105, 125, 144, 125, 125, 118, 140, 138, 57, 151, 45]},
  {"final_rank": 39, "team_name": "Andrew - Clutch and Chill", "total_points": 2226, "race_points": [105, 179, 146, 170, 140, 190, 114, 101, 125, 169, 163, 86, 139, 95, 57, 142, 105]},
  {"final_rank": 40, "team_name": "Diana - Baby Got Track", "total_points": 2225, "race_points": [147, 114, 92, 120, 126, 179, 114, 122, 137, 126, 104, 134, 128, 138, 127, 174, 143]},
  {"final_rank": 41, "team_name": "Robert - (PA) Posse in Effect", "total_points": 2215, "race_points": [57, 200, 118, 64, 53, 175, 107, 117, 126, 163, 149, 132, 125, 153, 154, 174, 148]},
  {"final_rank": 42, "team_name": "Doug - Bignotti’s Spanner", "total_points": 2207, "race_points": [141, 49, 126, 155, 169, 189, 97, 99, 116, 167, 151, 105, 106, 152, 113, 142, 130]},
  {"final_rank": 43, "team_name": "Craig - Red Flag Lap 199", "total_points": 2202, "race_points": [144, 159, 110, 133, 145, 152, 120, 143, 75, 89, 138, 98, 163, 152, 95, 140, 146]},
  {"final_rank": 44, "team_name": "Lauryn - Larry’s Lightning Laps", "total_points": 2200, "race_points": [104, 194, 126, 142, 137, 175, 149, 93, 88, 131, 133, 126, 139, 154, 134, 130, 45]},
  {"final_rank": 45, "team_name": "Josh - Pit Crews Fault", "total_points": 2194, "race_points": [151, 179, 140, 162, 136, 155, 92, 96, 52, 148, 127, 101, 91, 143, 147, 136, 138]},
  {"final_rank": 46, "team_name": "Troy - Racing 4 the future", "total_points": 2189, "race_points": [133, 133, 129, 131, 101, 158, 81, 152, 129, 142, 122, 123, 93, 121, 135, 157, 149]},
  {"final_rank": 47, "team_name": "Jeff  - Masters of faster", "total_points": 2177, "race_points": [142, 133, 114, 172, 169, 168, 128, 86, 116, 123, 57, 44, 117, 157, 160, 122, 169]},
  {"final_rank": 48, "team_name": "Greg & Charlie - The Apex Predators", "total_points": 2172, "race_points": [108, 152, 133, 160, 127, 139, 108, 104, 116, 166, 116, 116, 105, 164, 133, 128, 97]},
  {"final_rank": 49, "team_name": "Trent - Cincy3way", "total_points": 2164, "race_points": [107, 169, 133, 124, 153, 203, 124, 117, 82, 147, 142, 115, 147, 83, 148, 60, 110]},
  {"final_rank": 50, "team_name": "Jacen - Dr4gons", "total_points": 2157, "race_points": [137, 118, 175, 173, 53, 191, 113, 122, 146, 61, 163, 85, 122, 148, 143, 162, 45]},
  {"final_rank": 51, "team_name": "Renee - Speedway Ray", "total_points": 2146, "race_points": [134, 138, 140, 161, 132, 142, 122, 142, 113, 94, 158, 115, 117, 138, 129, 126, 45]},
  {"final_rank": 52, "team_name": "Nicki - Kiwi management", "total_points": 2144, "race_points": [114, 154, 129, 107, 112, 195, 170, 119, 92, 148, 136, 113, 56, 104, 110, 159, 126]},
  {"final_rank": 53, "team_name": "Matthew - Cars with Stripes Go Faster", "total_points": 2143, "race_points": [170, 97, 91, 64, 98, 154, 111, 149, 134, 135, 72, 106, 195, 150, 147, 140, 130]},
  {"final_rank": 54, "team_name": "Jeffrey - Prime47Boiler", "total_points": 2142, "race_points": [115, 160, 157, 160, 95, 196, 124, 136, 119, 139, 57, 44, 140, 178, 117, 120, 85]},
  {"final_rank": 55, "team_name": "Michael - Double Ritz", "total_points": 2120, "race_points": [123, 105, 122, 100, 131, 155, 87, 117, 52, 167, 135, 109, 151, 139, 108, 174, 145]},
  {"final_rank": 56, "team_name": "Lincoln  - Andretti makes Penske’s Johnson Trickle", "total_points": 2101, "race_points": [141, 169, 47, 169, 139, 171, 135, 52, 124, 161, 148, 106, 137, 171, 126, 60, 45]},
  {"final_rank": 57, "team_name": "John - TeamSlim", "total_points": 2093, "race_points": [73, 171, 137, 64, 138, 199, 135, 90, 128, 159, 167, 147, 85, 94, 159, 102, 45]},
  {"final_rank": 58, "team_name": "Scott - Gas Man Tom Sneva", "total_points": 2090, "race_points": [132, 169, 124, 166, 77, 209, 96, 112, 97, 86, 170, 92, 129, 111, 95, 121, 104]},
  {"final_rank": 59, "team_name": "Justin - FreeHotCarl", "total_points": 2088, "race_points": [125, 182, 114, 158, 125, 175, 98, 98, 162, 97, 182, 54, 88, 144, 108, 60, 118]},
  {"final_rank": 60, "team_name": "Matthew - OG Lysdexia", "total_points": 2086, "race_points": [115, 179, 47, 64, 91, 201, 50, 114, 110, 132, 115, 99, 140, 158, 155, 154, 162]},
  {"final_rank": 61, "team_name": "Mike - PRI Racing", "total_points": 2086, "race_points": [116, 177, 174, 125, 93, 188, 104, 90, 107, 135, 57, 44, 56, 124, 174, 120, 202]},
  {"final_rank": 62, "team_name": "Joe - SPIN TO WIN", "total_points": 2081, "race_points": [57, 172, 142, 64, 132, 191, 81, 110, 118, 106, 118, 116, 103, 141, 132, 145, 153]},
  {"final_rank": 63, "team_name": "Sam - SamAyersMotorsports", "total_points": 2075, "race_points": [96, 172, 77, 64, 130, 162, 162, 117, 139, 98, 132, 122, 130, 145, 158, 126, 45]},
  {"final_rank": 64, "team_name": "Johanna - OG Lysdexia’s ifWe", "total_points": 2001, "race_points": [165, 184, 47, 64, 134, 208, 50, 114, 52, 144, 131, 143, 56, 43, 149, 142, 175]},
  {"final_rank": 65, "team_name": "Chris - No Attack No Chance", "total_points": 1991, "race_points": [83, 112, 111, 107, 122, 146, 107, 130, 156, 106, 117, 138, 140, 73, 112, 116, 115]},
  {"final_rank": 66, "team_name": "Martina - Left Turn Louise", "total_points": 1979, "race_points": [57, 179, 103, 124, 128, 86, 131, 141, 108, 138, 143, 88, 137, 43, 180, 60, 133]},
  {"final_rank": 67, "team_name": "Jenna - Brickyard Bandit", "total_points": 1968, "race_points": [133, 125, 95, 117, 135, 143, 90, 98, 124, 88, 117, 118, 70, 94, 123, 151, 147]},
  {"final_rank": 68, "team_name": "Wesley - Molar Madness", "total_points": 1939, "race_points": [146, 49, 146, 143, 117, 184, 105, 111, 126, 145, 107, 131, 56, 135, 133, 60, 45]},
  {"final_rank": 69, "team_name": "Mallory - The Ice Woman", "total_points": 1883, "race_points": [107, 190, 47, 64, 93, 166, 127, 110, 120, 146, 114, 112, 157, 168, 57, 60, 45]},
  {"final_rank": 70, "team_name": "Sarah - Brickyard Bandits", "total_points": 1878, "race_points": [57, 49, 92, 136, 125, 178, 142, 131, 94, 124, 137, 119, 141, 94, 154, 60, 45]},
  {"final_rank": 71, "team_name": "John - Stud Muffin", "total_points": 1824, "race_points": [137, 109, 127, 117, 118, 171, 50, 167, 118, 82, 57, 44, 56, 108, 86, 123, 154]},
  {"final_rank": 72, "team_name": "Eli - Team Zach Smith Sucks", "total_points": 1823, "race_points": [162, 143, 133, 80, 135, 167, 96, 52, 118, 171, 57, 44, 56, 130, 174, 60, 45]},
  {"final_rank": 73, "team_name": "Devon - Fully Bricked", "total_points": 1795, "race_points": [117, 117, 111, 115, 84, 158, 128, 139, 52, 92, 57, 44, 125, 130, 151, 130, 45]},
  {"final_rank": 74, "team_name": "Tracy - Life is a Highway", "total_points": 1793, "race_points": [140, 110, 109, 150, 130, 143, 144, 106, 71, 84, 92, 95, 109, 103, 57, 105, 45]},
  {"final_rank": 75, "team_name": "Haley - Haley's Comets", "total_points": 1770, "race_points": [106, 159, 118, 117, 53, 188, 100, 132, 125, 102, 57, 44, 56, 156, 57, 107, 93]},
  {"final_rank": 76, "team_name": "Mike - Prach Motors", "total_points": 1764, "race_points": [152, 184, 125, 137, 165, 86, 144, 110, 52, 167, 57, 44, 56, 43, 137, 60, 45]},
  {"final_rank": 77, "team_name": "Bryce - Fuzzy’s Grandstand", "total_points": 1723, "race_points": [163, 121, 116, 134, 118, 181, 94, 52, 145, 96, 57, 44, 56, 103, 138, 60, 45]},
  {"final_rank": 78, "team_name": "Jonathan - DoitforDale", "total_points": 1701, "race_points": [144, 195, 132, 132, 53, 177, 101, 91, 83, 61, 57, 44, 112, 129, 85, 60, 45]},
  {"final_rank": 79, "team_name": "Christopher - Need for Speed", "total_points": 1604, "race_points": [117, 177, 112, 64, 178, 188, 86, 133, 52, 108, 57, 44, 83, 43, 57, 60, 45]},
  {"final_rank": 80, "team_name": "Mary - Jazz Racing", "total_points": 1528, "race_points": [147, 153, 113, 140, 53, 179, 90, 77, 52, 162, 57, 44, 56, 43, 57, 60, 45]},
  {"final_rank": 81, "team_name": "Clark - Powering the Will to Win", "total_points": 1485, "race_points": [142, 179, 103, 158, 114, 148, 114, 52, 52, 61, 57, 44, 56, 43, 57, 60, 45]},
  {"final_rank": 82, "team_name": "Edye - Best Regards🌹", "total_points": 1407, "race_points": [86, 49, 126, 145, 53, 86, 141, 52, 99, 61, 57, 44, 56, 43, 57, 60, 192]},
  {"final_rank": 83, "team_name": "Tom - Open Wheel Mercenary", "total_points": 1367, "race_points": [151, 143, 47, 143, 128, 86, 50, 52, 144, 61, 57, 44, 56, 43, 57, 60, 45]},
  {"final_rank": 84, "team_name": "Roy  - Breakfast at Charlie Browns", "total_points": 1261, "race_points": [165, 190, 126, 64, 53, 86, 50, 52, 52, 61, 57, 44, 56, 43, 57, 60, 45]},
  {"final_rank": 85, "team_name": "Patrick - Katherine Legge’s Fan", "total_points": 1233, "race_points": [132, 195, 126, 64, 53, 86, 50, 52, 52, 61, 57, 44, 56, 43, 57, 60, 45]},
  {"final_rank": 86, "team_name": "Chase - Katherine crashed on the 3rd legge", "total_points": 1155, "race_points": [105, 142, 47, 64, 53, 167, 50, 52, 52, 61, 57, 44, 56, 43, 57, 60, 45]},
  {"final_rank": 87, "team_name": "Matt - FastFeathers", "total_points": 1144, "race_points": [148, 169, 47, 64, 53, 86, 50, 52, 52, 61, 57, 44, 56, 43, 57, 60, 45]},
  {"final_rank": 88, "team_name": "Anthony - Pato's Pitcrew", "total_points": 966, "race_points": [90, 49, 47, 64, 53, 86, 50, 52, 52, 61, 57, 44, 56, 43, 57, 60, 45]},
  {"final_rank": 89, "team_name": "Adam - Smoke and mirrors", "total_points": 933, "race_points": [57, 49, 47, 64, 53, 86, 50, 52, 52, 61, 57, 44, 56, 43, 57, 60, 45]}
]
$hof_2025_data$::jsonb;
begin
  if exists (
    select 1 from public.hall_of_fame_seasons where season_year = 2025
  ) then
    raise exception '2025 already exists in Hall of Fame. Nothing was changed. Run 02_verify_2025.sql to check it; do not delete the existing archive.';
  end if;

  if jsonb_array_length(entries) <> 89 then
    raise exception 'Expected exactly 89 entries for 2025.';
  end if;

  if (
    select count(distinct entry.final_rank)
    from jsonb_to_recordset(entries) as entry(final_rank integer)
  ) <> 89 then
    raise exception 'The 2025 final ranks must be unique.';
  end if;

  if (
    select count(distinct lower(btrim(entry.team_name)))
    from jsonb_to_recordset(entries) as entry(team_name text)
  ) <> 89 then
    raise exception 'The 2025 participant/team labels must be unique.';
  end if;

  for source_row in
    select * from jsonb_to_recordset(entries) as entry(
      final_rank integer, team_name text, total_points integer, race_points integer[]
    )
  loop
    if source_row.final_rank is null or source_row.final_rank not between 1 and 89
      or source_row.team_name is null or length(btrim(source_row.team_name)) = 0
      or source_row.total_points is null or source_row.total_points < 0
      or cardinality(source_row.race_points) is distinct from 17
    then
      raise exception 'Invalid 2025 entry at rank %.', source_row.final_rank;
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
      select entry.total_points,
        lag(entry.total_points) over (order by entry.final_rank) as previous_points
      from jsonb_to_recordset(entries) as entry(final_rank integer, total_points integer)
    ) ordered
    where ordered.total_points > ordered.previous_points
  ) then
    raise exception 'Final ranks are inconsistent with descending season points.';
  end if;

  select entry.team_name, entry.total_points into champion_label, champion_points
  from jsonb_to_recordset(entries) as entry(
    final_rank integer, team_name text, total_points integer
  ) where entry.final_rank = 1;

  if champion_label is distinct from 'Nicholas - Pickle'
    or champion_points is distinct from 2548
  then
    raise exception 'The 2025 champion does not match the supplied leaderboard.';
  end if;

  insert into public.hall_of_fame_seasons (
    season_year, champion_team_name, champion_total_points,
    participant_count, race_count, finalized_by
  ) values (2025, champion_label, champion_points, 89, 17, null)
  returning id into archive_id;

  insert into public.hall_of_fame_entries (
    season_id, final_rank, team_name, total_points, race_breakdown
  )
  select archive_id, entry.final_rank, entry.team_name, entry.total_points, '[]'::jsonb
  from jsonb_to_recordset(entries) as entry(
    final_rank integer, team_name text, total_points integer
  )
  order by entry.final_rank;

  get diagnostics imported_count = row_count;
  if imported_count <> 89 then
    raise exception 'Expected 89 imported entries, received %. Import cancelled.', imported_count;
  end if;

  if exists (
    select 1 from jsonb_to_recordset(entries) as source(
      final_rank integer, team_name text, total_points integer
    )
    where not exists (
      select 1 from public.hall_of_fame_entries saved
      where saved.season_id = archive_id
        and saved.final_rank = source.final_rank
        and saved.team_name = source.team_name
        and saved.total_points = source.total_points
        and saved.race_breakdown = '[]'::jsonb
    )
  ) then
    raise exception 'Imported entries do not match the source. Import cancelled.';
  end if;
end;
$hof_2025_import$;

commit;

-- Read-only verification; safe to run again after the import.
select
  case
    when season.champion_team_name = 'Nicholas - Pickle'
      and season.champion_total_points = 2548
      and season.participant_count = 89
      and season.race_count = 17
      and count(entry.id) = 89
      and count(distinct entry.final_rank) = 89
      and min(entry.final_rank) = 1
      and max(entry.final_rank) = 89
      and sum(entry.total_points) = 186227
      and count(*) filter (
        where entry.final_rank = 1
          and entry.team_name = season.champion_team_name
          and entry.total_points = season.champion_total_points
      ) = 1
    then 'PASS'
    else 'CHECK IMPORT'
  end as verification_status,
  season.season_year,
  season.champion_team_name,
  season.champion_total_points,
  season.race_count,
  count(entry.id) as imported_entries,
  round(season.champion_total_points::numeric / season.race_count, 2) as champion_points_per_race
from public.hall_of_fame_seasons season
left join public.hall_of_fame_entries entry on entry.season_id = season.id
where season.season_year = 2025
group by season.id;
