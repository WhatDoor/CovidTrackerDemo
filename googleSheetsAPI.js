const { GoogleSpreadsheet } = require('google-spreadsheet');
const date = require('date-and-time');
 
// spreadsheet key is the long id in the sheets URL
const spreadsheet_key = '1P4zNyjnUN29SVdIvYqSYXN4JNewMQUp4A_b0uZmjhJs'

const doc = new GoogleSpreadsheet(spreadsheet_key);

async function uploadData(data) {
    // use service account creds
    const creds = require('./creds.json');
    await doc.useServiceAccountAuth(creds);

    // loads document properties and worksheets
    await doc.loadInfo(); 
    
    //Copy Masterlist
    const MasterSheet = doc.sheetsByIndex[0];
    await MasterSheet.loadCells()
    await MasterSheet.copyToSpreadsheet(spreadsheet_key)

    //Load Current Sheet
    await doc.loadInfo(); //Reload document properties and worksheets
    const sheet = doc.sheetsByIndex[doc.sheetCount-1];
    await sheet.loadCells()

    //Set sheet name as current date
    const now = new Date(); 
    await sheet.updateProperties({title:date.format(now,'D/M/YY')})
    
    startingRow = 14;
    
    //Fill Cells for each entry in data
    for (item of data) {
        //Need to split out registrations if others are included
        if (item.SeatsReserved > 1) {
            list = item.OtherPersons.split(',',item.SeatsReserved-1)
            list.unshift(item.Name)

            for (person of list) {
                nameCell = await sheet.getCell(startingRow,0)
                contactCell = await sheet.getCell(startingRow,2)
                emailCell = await sheet.getCell(startingRow,4)

                nameCell.value = person.trim()
                contactCell.value = item.ContactNumber
                emailCell.value = item.email

                startingRow = startingRow + 1
            }

        } else {
            nameCell = await sheet.getCell(startingRow,0)
            contactCell = await sheet.getCell(startingRow,2)
            emailCell = await sheet.getCell(startingRow,4)

            nameCell.value = item.Name
            contactCell.value = item.ContactNumber
            emailCell.value = item.email

            startingRow = startingRow + 1
        }
    }

    await sheet.saveUpdatedCells()
}

module.exports = {
    uploadData: uploadData
}