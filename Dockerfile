FROM nginx:alpine

# Copy static app files into nginx's default serve directory
COPY index.html /usr/share/nginx/html/
COPY app.js /usr/share/nginx/html/
COPY rangerover-responsive.html /usr/share/nginx/html/
COPY rangerover-standalone.html /usr/share/nginx/html/

EXPOSE 80
