const express = require('express');
const app = express();
const port  = 3000;

app.listen(port, (error) => {
    if(error) {
        console.log('Something went wrong', error);
    } else {
        console.log(`Server is running on port ${port}`);
    }
});

app.post('/api/v1/generatePdf', (req, res) => {
    res.send('PDF generated successfully');
});
