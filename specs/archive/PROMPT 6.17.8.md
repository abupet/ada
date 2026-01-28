
#Scelta API Key
Pagina Impostazioni ha selettore impostare quale API Key usare, generale o per calcolare i consumi. Di default quello generale. ADA memorizza l’ultima selezione e la mantiene. Attualmente il file contiene ENCRYPTED_API_KEY e ENCRYPTED_API_KEY. Ora si vogliono usare queste due versioni:

##API KEY GENERALE
const ENCRYPTED_API_KEY = "A7FubCcvia470VWvttp18JVzp5wk1f35ifTTnBdxSnoyBRs7Zu6bx0JvIgSaIX4eCNH6IKsioaCPaUrM3unQFEVKqkAt1Zw4sy49G0YbJ3VrGI8NtRK83WRt9bQsunk4ImTCRoe2VovBnQY8wPXbIRUOF4j/ZKM/aAxNIiqURMJ9ONxEqcdaF8jzxTa1pz4h+atT8Eznc4n8ieV3vn1Ogr3x2I/8FyPxCZYDis+ZdTuqQg75LeXBfDT96+IIh1YG";
const SALT = "AVtym8pjI4+GwoODj6olxg==";

##API KEY CALCOLO COSTI
const ENCRYPTED_API_KEY = "WYYErtnVUjxyzBsgOWGh1AU2jRczMVda2Pa2M3xsHAAaY5ctAgLVuBuU8R/5jb9vDbEEwZtbnNM8Bd/CcPGpN9P9Qp4XXtCy2eXcY+o6W+kyMAcHgi9qWCdxux5Gqa6mZOKM9X+NWQEzEHl0xpLF2J4OaTx7Q2u7mmck4+c4NGcR+0+b569AA3iT3DBDw4K91JvFesMIYkFmzrDTz0I49yPGJ1XREGiOW1Bw0N5zlc4vTQvvoqz1UzBLx+sUnN4r";
const SALT = "p4HVrE41221kqMqKuLC23Q==";

#Pagina Debug
Le seguenti sezioni passano dalla pagina “Impostazioni” alla pagina “Debug”:
•	la sezione “Registrazione a chunk (robusta)”
•	Il pulsante “Consumo API”
•	Il pulsante “📄 Scarica Log Errori (ADA.log)”
•	Il pulsante “🗑️ Cancella Log Errori”
La sezione “Registrazione a chunk (robusta)” può essere “chiusa” o “aperta”

#Pagina Impostazioni
Il logo che compare nelle intestazioni delle pagine diventa un’immagine che è possibile caricare e cambiare dalla pagina “Impostazioni”. Si chiama “Logo clinica”.

#Per fare i test robusti
Se non ci sono già, aggiungi data-testid nei bottoni e nelle aree di stato/log.
Aggiorna i file di test in modo coerente con le modifiche fatte.

#Bug
Correggere i seguenti bug:
L’intestazione delle pagine, che contiene il nome e la specie del pet ed il logo Anicura, rimane visibile sopra la sidebar, quando questa è aperta. Correggere: la sidebar deve apparire sopra tutta la pagina.

