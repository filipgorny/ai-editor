Do zrealizowania na wersję 0.3:

Ważną rzeczą jest podział na widoki.
Widoki mają swoje ikony i są widoczne
po lewej od drzewka z plikami, przesuwamy drzewko
trochę w prawo i robimy coś jakby zakładki.
Każdy widok ma swoją ikonę.

0. Widok edycji kodu. Przekładamy graf do innego widoku, jeśli nic nie jest otwarte to nie
ma nic pod spodem, oprócz tapety ewentualnie. Cały czas mamy na dole pole do AI które wie
co mamy na ekranie i może nam pomóc.
Przyciski na myszce back i forward przełączają okna edytora.

Mamy coś jak telescope. Esc+Space otwiera okno w którym na
dole jest duży input, a do góry jest wysoki prostokąt z listą
plików (ale z ikonkami nerd-icons). Wpisujać coś, robimy jakby
grep, zarównno na na nazwie pliku ale i na jego treści.

Lista plików po prawej dostaje menu na prawy przycisk:
- dodaj plik, dodaj folder
- gdy klikamy na coś istniejącego: zmień nazwę, usuń.
Możemy robić drag and drop żeby  segregowąć pliki.

1. Widok diagramu kodu osobnym stałym oknem.
- nastawione na wypełnianie treści przez AI
- edycja listy metod klasy
- możliwość opisania klasy/funkcji
- prawym przyciskiem wybieramy opcje
- możemy otworzyć do edycji
- możemy wypełnić opis ktróry pomoże AI
- jest opcja "Wygeneruj kod"
chociaż klasy się automatycznie
tworzą ale mają puste metody.
Jeśli kod jest już zrobiony.
Scanner service wykrywa czy
ta klasa/funkcja ma kod czy
nie i ta opcja może być włączona
lub wyłączona.

2. Widok diagramu deploymentu - tree zmienia sie w galerie ikon typu prostokąt, baza danych, chmura
- kształty można zwiększać, żmniejszać. Kształty są czarnobiałe i w środku można dodać tekst
jak się dwukrotnie kliknie.
Kształty można łączyć róznego typu strzałkami. Pod galerią kształtów są ustawienia rodzaju
strzałek, pełne, puste, bez strzałki, z dwóch stron...

3. Widok z wszystkimi wiadomoścami do i od LLM.
- Tutaj możemy vibe kodować, LLM gdy dopisuje kod, pokazuje się monospace area
z innym tłem i tam kod który dodaje.
- wiadomości są ładnie wystylowane, przychodzące są z jaśniejszym tłęm.

4. Widok zadań i wybór aktualnie realizowanego zadania. Możliwość połączenia z Jirą.
Opcja automatycznie tworzonego brancha.

5. Tryb review - Ai dodaje komeentarze przy kodzie - chmurki. Ale tylko tam gdzie
coś było zmieniane. W tree są tylko pliki które zostały zmodyfikowane. W edytorze
doodane linie mają zielony numer lini, edytowane żółty.

6. Terminal.
Po prostu emulator terminala, ale dobry.
Czcionka Hack. Prawie białą, czarne tło.
Kolory.

7. Widok przeglądarki internetowej.
- pasek adresu
- okno strony
W przyszłości możliwość debugowania, póki
co poprostu ułatwienie dla web developerów.
Możliwość nagrania makra. W pasku tytułowym
(bo przeglądarka działa podobnie jak edytory,
każda strona ma swoje okno) jest przycisk
z listą makr. Makra są napisane w Lua,
na począktu mamy takie podstwawowe opcje
jak kliknij, napisz itp. Podajemy zwykle
selectory. Czyli:
type('#email', 'filip.gorny@gmai.com'
type('#password', 'test')
click('#submit')

Dodatkowo:
Przenieść przełącznik "vim keys" do ustawień (copilot też) i jeśli jest włączony to możemy
np nawigować po oknach i panelach jak w w neovim. Na Escape przechodzimy do pola AI,
ale mozemy tam wpisywać znane z nvim'a polecenia jak :%s/raz/dwa/g
Jeżeli na począktu jest dwukropek to nie poleci do LLM. Chociaż równie dobrze
możemy wpisać zamień wszystkie raz na dwa i LLM to zrobi.

Ustawienia:
Rozbudowujemy je, niech będą troche szersze i mają taby. Pierwszy tab to to co jest
a drugi to właśnie vim i copilot i pewnie potem więce.

Interfejs:
- do poprawy nazwy otwwartych edytoróœ: czcionka Hack, tylko pionowe kreski pomiędzy
tabami
- Usuwamy napis Ai-architekt, i wstawiamy tam statystyki, ile dzisiaj klawiszy
zostało wcisniętych, ile lini kodu napisanych, ile zadań skończonych.
- pomiędzy widokami możemy przełączać się ALT+numer

Do zrobienia jeszcze:
- ściągnąć więcej motywów
- Opcje dodatkowe (do włączenia/wyłączenia):
    - rainbox brackets
    - każda funkcja i klasaa ma swój kolor
- Escape zawsze prowadzi do AI Area
- między plikami możemy się przełączać ALT+strzałki
- Shift+tab przełącza między widokami
- te skróty to wbudowanys skrypt który można zmodyfikować
 w oknie do zarządzania skryptami

W przyszłości (teraz nie robimy):
- wizualny edytor UI (React)

