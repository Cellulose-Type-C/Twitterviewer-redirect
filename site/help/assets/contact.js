(function () {
  "use strict";

  var BACKEND_ENDPOINT = "/api/contact";

  var form = document.getElementById("contact-form");
  var status = document.getElementById("form-status");
  var submitButton = document.getElementById("contact-submit");

  if (!form || !status || !submitButton) {
    return;
  }

  function setStatus(message, state) {
    status.textContent = message;
    if (state) {
      status.setAttribute("data-state", state);
    } else {
      status.removeAttribute("data-state");
    }
  }

  form.addEventListener("submit", function (event) {
    event.preventDefault();

    if (typeof form.reportValidity === "function" && !form.reportValidity()) {
      return;
    }

    var data = new FormData(form);
    var payload = {
      name: String(data.get("name") || "").trim(),
      email: String(data.get("email") || "").trim(),
      subject: String(data.get("subject") || "").trim(),
      message: String(data.get("message") || "").trim(),
      website: String(data.get("website") || "")
    };

    submitButton.disabled = true;
    setStatus("Sending your message\u2026", "pending");

    fetch(BACKEND_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    })
      .then(function (response) {
        if (response.ok) {
          form.reset();
          setStatus("Message sent. Thanks \u2014 we will reply by email.", "success");
          return;
        }

        return response
          .text()
          .then(function (raw) {
            var problem = {};
            try {
              problem = JSON.parse(raw);
            } catch (parseError) {
              problem = {};
            }

            console.error(
              "[contact] POST " + BACKEND_ENDPOINT + " failed with " + response.status,
              raw.slice(0, 300)
            );

            if (response.status === 400 && problem.error) {
              setStatus(problem.error, "error");
              return;
            }

            if (response.status === 404 || response.status === 405) {
              setStatus(
                "The contact service is not available on this deployment.",
                "error"
              );
              return;
            }

            if (response.status === 503) {
              setStatus(
                "The contact form is temporarily unavailable. Please try again later.",
                "error"
              );
              return;
            }

            setStatus(
              "Your message could not be sent right now. Please try again in a few minutes.",
              "error"
            );
          });
      })
      .catch(function () {
        setStatus(
          "Could not reach the contact service. Check your connection and try again.",
          "error"
        );
      })
      .then(function () {
        submitButton.disabled = false;
      });
  });

  var searchInput = document.getElementById("help-search");
  var faqItems = Array.prototype.slice.call(
    document.querySelectorAll("[data-help-item]")
  );
  var emptyMessage = document.getElementById("faq-empty");

  if (searchInput && faqItems.length > 0) {
    searchInput.addEventListener("input", function () {
      var query = searchInput.value.trim().toLowerCase();
      var visible = 0;

      faqItems.forEach(function (item) {
        var matches =
          query === "" || item.textContent.toLowerCase().indexOf(query) !== -1;
        item.hidden = !matches;
        if (matches) {
          visible += 1;
        }
      });

      if (emptyMessage) {
        emptyMessage.style.display = visible === 0 ? "block" : "none";
      }
    });
  }
})();
