(function () {
    const eventId = 8;
    const guestId = null;
    const csrfMeta = document.querySelector('meta[name="csrf-token"]');
    const csrfToken = csrfMeta ? csrfMeta.content : '';

    window.addEventListener('message', function (e) {
        const msg = e.data;
        if (!msg || typeof msg !== 'object' || msg.type !== 'balcony:rsvp') {
            return;
        }

        fetch('https://www.itsbalcony.com/api/rsvp', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-TOKEN': csrfToken,
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                eventId: eventId,
                guestId: guestId,
                contact: typeof msg.contact === 'string' ? msg.contact : null,
                name: typeof msg.name === 'string' ? msg.name : null,
                responses: Array.isArray(msg.responses) ? msg.responses : [],
                message: typeof msg.message === 'string' ? msg.message : null
            })
        });
    });
})();
